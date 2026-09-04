// planStack() against a fake Docker daemon: what the whole-stack plan says
// when components are unconfigured, when the VPN is switched off, and when a
// container the Suite created outlives the component it belonged to.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { planStack } from "../src/reconcile/reconciler.js";
import { VPN_ENABLED_SETTING } from "../src/reconcile/catalog.js";
import { managedLabels } from "../src/docker/labels.js";
import { computeSpecHash } from "../src/docker/spec.js";
import { saveComponentValues } from "../src/store/components.js";
import { setSetting } from "../src/store/settings.js";
import { freshDatabase } from "./helpers.js";

let server;
let containers; // name -> { Id, name, Config: { Labels } }

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => route(req.method, url, res));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  process.env.DOCKER_PROXY_URL = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

beforeEach(() => {
  freshDatabase();
  containers = new Map();
  // These cases are about gluetun. Postgres is managed by default, which would
  // add a second row to every plan below; pointing it at an external server
  // takes it out of the stack without disabling anything under test.
  saveComponentValues("postgres", {
    mode: "external",
    host: "db.example",
    port: "5432",
    adminUser: "postgres",
    adminPassword: "x",
  });
});

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function route(method, url, res) {
  // Orphan detection lists by label; the fake honours the filter so a test
  // cannot pass by accident on an unfiltered list.
  if (method === "GET" && url.pathname === "/v1.43/containers/json") {
    const filters = JSON.parse(url.searchParams.get("filters") || "{}");
    const wanted = filters.label || [];
    const matches = [...containers.values()].filter((c) =>
      wanted.every((pair) => {
        const [k, v] = pair.split("=");
        return (c.Config.Labels || {})[k] === v;
      })
    );
    return json(
      res,
      200,
      matches.map((c) => ({ Id: c.Id, Names: [`/${c.name}`], Labels: c.Config.Labels }))
    );
  }

  const containerMatch = url.pathname.match(/^\/v1\.43\/containers\/([^/]+)\/json$/);
  if (method === "GET" && containerMatch) {
    const name = decodeURIComponent(containerMatch[1]);
    const container = containers.get(name) || [...containers.values()].find((c) => c.Id === name);
    if (!container) return json(res, 404, { message: "No such container" });
    return json(res, 200, { Id: container.Id, Config: { Labels: container.Config.Labels } });
  }

  // The Suite inspects its own container to compute FIREWALL_OUTBOUND_SUBNETS;
  // anything unmatched above is that lookup, which is allowed to fail.
  json(res, 404, { message: "No such container" });
}

const GLUETUN_CONFIG = {
  networks: "ssbackend",
  vpnServiceProvider: "nordvpn",
  vpnType: "wireguard",
  wireguardPrivateKey: "a-key",
};

function configureGluetun() {
  saveComponentValues("gluetun", GLUETUN_CONFIG);
}

function vpn(enabled) {
  setSetting(VPN_ENABLED_SETTING, enabled ? "true" : "false");
}

test("an unconfigured component appears as incomplete rather than being skipped", async () => {
  const { plans } = await planStack();

  assert.equal(plans.length, 1);
  assert.equal(plans[0].kind, "gluetun");
  assert.equal(plans[0].action, "incomplete");
  assert.ok(plans[0].errors.length > 0);
});

test("a configured component with nothing deployed plans a create", async () => {
  configureGluetun();
  const { plans, summary } = await planStack();

  assert.equal(plans[0].action, "create");
  assert.equal(summary.changes, 1);
});

test("a deployed component matching its configuration plans a no-op", async () => {
  configureGluetun();
  const { plans: first } = await planStack();

  containers.set("streamshare-suite-gluetun", {
    Id: "gluetun-id",
    name: "streamshare-suite-gluetun",
    Config: { Labels: managedLabels("gluetun", first[0].desiredHash, "") },
  });

  const { plans, summary } = await planStack();
  assert.equal(plans[0].action, "noop");
  assert.equal(summary.changes, 0);
});

test("switching the VPN off removes gluetun from the plan entirely", async () => {
  configureGluetun();
  vpn(false);

  const { plans } = await planStack();
  assert.equal(plans.filter((p) => p.kind === "gluetun" && p.action !== "orphaned").length, 0);
});

test("a managed container whose component left the stack is reported as orphaned", async () => {
  configureGluetun();
  containers.set("streamshare-suite-gluetun", {
    Id: "gluetun-id",
    name: "streamshare-suite-gluetun",
    Config: { Labels: managedLabels("gluetun", "some-hash", "") },
  });

  vpn(false);

  const { plans } = await planStack();
  const orphan = plans.find((p) => p.action === "orphaned");

  assert.ok(orphan, "expected the running gluetun to be reported once it left the stack");
  assert.equal(orphan.containerId, "gluetun-id");
  assert.equal(orphan.containerName, "streamshare-suite-gluetun");
  assert.ok(orphan.runtime, "an orphan row should still carry a runtime object");
});

test("an orphan is never counted as a change — removing it is its own action", async () => {
  configureGluetun();
  containers.set("streamshare-suite-gluetun", {
    Id: "gluetun-id",
    name: "streamshare-suite-gluetun",
    Config: { Labels: managedLabels("gluetun", "some-hash", "") },
  });
  vpn(false);

  const { summary } = await planStack();
  assert.equal(summary.changes, 0);
});

test("a container the Suite did not create is never reported as an orphan", async () => {
  configureGluetun();
  containers.set("someone-elses-container", {
    Id: "foreign",
    name: "someone-elses-container",
    Config: { Labels: { "com.example.other": "true" } },
  });
  vpn(false);

  const { plans } = await planStack();
  assert.equal(plans.filter((p) => p.action === "orphaned").length, 0);
});

test("a managed container still belonging to the stack is not an orphan", async () => {
  configureGluetun();
  const { plans: first } = await planStack();
  containers.set("streamshare-suite-gluetun", {
    Id: "gluetun-id",
    name: "streamshare-suite-gluetun",
    Config: { Labels: managedLabels("gluetun", first[0].desiredHash, "") },
  });

  const { plans } = await planStack();
  assert.equal(plans.filter((p) => p.action === "orphaned").length, 0);
  assert.equal(plans[0].action, "noop");
});

test("changing configuration after deployment plans a recreate", async () => {
  configureGluetun();
  containers.set("streamshare-suite-gluetun", {
    Id: "gluetun-id",
    name: "streamshare-suite-gluetun",
    Config: { Labels: managedLabels("gluetun", "a-stale-hash", "") },
  });

  const { plans, summary } = await planStack();
  assert.equal(plans[0].action, "recreate");
  assert.equal(plans[0].previousHash, "a-stale-hash");
  assert.equal(summary.restarts, 1);
});

test("the spec hash a plan reports is the one computed from the rendered spec", async () => {
  configureGluetun();
  const { plans } = await planStack();
  assert.equal(plans[0].desiredHash, computeSpecHash(plans[0].spec));
});

// --- upgrading from phase 1 -------------------------------------------------
//
// A container created before this phase carries no component-key label. It
// must keep reading as the same component: a false orphan would tell someone
// their working gluetun no longer belongs to the stack, and a false recreate
// would drop their VPN to change nothing.

function phase1Labels(hash) {
  return {
    "streamshare.suite.managed": "true",
    "streamshare.suite.component": "gluetun",
    "streamshare.suite.spec-hash": hash,
  };
}

test("a container created before component keys existed still plans as a no-op", async () => {
  configureGluetun();
  const { plans: first } = await planStack();

  containers.set("streamshare-suite-gluetun", {
    Id: "phase-1-id",
    name: "streamshare-suite-gluetun",
    Config: { Labels: phase1Labels(first[0].desiredHash) },
  });

  const { plans } = await planStack();
  assert.equal(plans[0].action, "noop", "adding a label must not invalidate an existing container");
});

test("a container created before component keys existed is never mistaken for an orphan", async () => {
  configureGluetun();
  const { plans: first } = await planStack();

  containers.set("streamshare-suite-gluetun", {
    Id: "phase-1-id",
    name: "streamshare-suite-gluetun",
    Config: { Labels: phase1Labels(first[0].desiredHash) },
  });

  const { plans } = await planStack();
  assert.equal(plans.filter((p) => p.action === "orphaned").length, 0);
});

// --- switched off, but still running ----------------------------------------
//
// A container the Suite adopted carries none of its labels, so the orphan pass
// cannot see it. Switching its component off must not make it disappear from
// the plan while it carries on running: an empty screen is the wrong way to
// say "your VPN container is still up and we are not touching it".

function adoptedContainer() {
  containers.set("streamshare-suite-gluetun", {
    Id: "someone-elses-gluetun",
    name: "streamshare-suite-gluetun",
    Config: { Labels: {} },
  });
}

test("an adopted container is reported as switched off, not silently dropped", async () => {
  configureGluetun();
  adoptedContainer();
  vpn(false);

  const { plans } = await planStack();
  const row = plans.find((p) => p.action === "disabled");

  assert.ok(row, "a running adopted container must still appear once its component is off");
  assert.equal(row.containerId, "someone-elses-gluetun");
  assert.equal(row.containerName, "streamshare-suite-gluetun");
  assert.match(row.reason, /still running/i);
  assert.ok(row.runtime, "a switched-off-but-running row should still carry a runtime object");
});

test("a switched-off component with nothing running produces no row at all", async () => {
  configureGluetun();
  vpn(false);

  const { plans } = await planStack();
  assert.equal(plans.length, 0, "nothing on the host means nothing to say");
});

test("a switched-off row is never counted as a change", async () => {
  configureGluetun();
  adoptedContainer();
  vpn(false);

  const { summary } = await planStack();
  assert.equal(summary.changes, 0);
  assert.equal(summary.disabled, 1);
});

test("a managed container of a switched-off component is reported once, as an orphan", async () => {
  configureGluetun();
  containers.set("streamshare-suite-gluetun", {
    Id: "ours",
    name: "streamshare-suite-gluetun",
    Config: { Labels: managedLabels("gluetun", "some-hash", "") },
  });
  vpn(false);

  const { plans } = await planStack();
  assert.equal(plans.length, 1, "an orphan must not also be reported as switched off");
  assert.equal(plans[0].action, "orphaned");
});

test("switching the VPN back on returns the adopted container to an adopt", async () => {
  configureGluetun();
  adoptedContainer();

  vpn(false);
  assert.equal((await planStack()).plans[0].action, "disabled");

  vpn(true);
  assert.equal((await planStack()).plans[0].action, "adopt");
});
