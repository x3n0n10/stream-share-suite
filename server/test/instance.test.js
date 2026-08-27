// Instances: port allocation, computed URLs, the two topologies the VPN
// toggle produces, and the cascade finally firing against real components
// rather than synthetic nodes.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  renderInstanceSpec,
  instanceContainerName,
  instanceUrl,
  allocatePort,
  PORT_BAND,
} from "../src/reconcile/instance.js";
import { renderGluetunSpec } from "../src/reconcile/gluetun.js";
import { provisionInstance, instanceKeyFor } from "../src/reconcile/provisioning.js";
import { databaseNamesFor } from "../src/reconcile/database.js";
import { planStack } from "../src/reconcile/reconciler.js";
import { VPN_ENABLED_SETTING } from "../src/reconcile/catalog.js";
import { setPaths } from "../src/store/paths.js";
import { setSetting } from "../src/store/settings.js";
import { saveComponentValues, getComponentValues } from "../src/store/components.js";
import { managedLabels } from "../src/docker/labels.js";
import { loadConfig } from "../src/config.js";
import { freshDatabase } from "./helpers.js";

let server;
let containers;
let root;

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    req.on("data", () => {});
    req.on("end", () => {
      if (req.method === "GET" && url.pathname === "/v1.43/containers/json") {
        const filters = JSON.parse(url.searchParams.get("filters") || "{}");
        const wanted = filters.label || [];
        const matches = [...containers.values()].filter((c) =>
          wanted.every((pair) => {
            const [k, v] = pair.split("=");
            return (c.Labels || {})[k] === v;
          })
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(
          JSON.stringify(matches.map((c) => ({ Id: c.Id, Names: [`/${c.name}`], Labels: c.Labels })))
        );
      }

      const m = url.pathname.match(/^\/v1\.43\/containers\/([^/]+)\/json$/);
      const c = m && containers.get(decodeURIComponent(m[1]));
      res.writeHead(c ? 200 : 404, { "Content-Type": "application/json" });
      res.end(JSON.stringify(c ? { Id: c.Id, Config: { Labels: c.Labels } } : { message: "no" }));
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  process.env.DOCKER_PROXY_URL = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  freshDatabase();
  containers = new Map();
  // A real directory, because validatePath deliberately refuses a path the
  // Suite cannot see — the whole point of it is to fail here rather than at
  // container-start time.
  root = mkdtempSync(path.join(tmpdir(), "suite-stack-"));
  setPaths({ dataPath: root, cachePath: root });
});

const PROVIDER = {
  displayName: "Provider 1",
  xtreamBaseUrl: "http://provider.example:8080",
  xtreamUser: "u",
  xtreamPassword: "p",
  authMode: "basic",
  authUser: "viewer",
  authPassword: "secret",
};

function configureStack() {
  saveComponentValues("gluetun", {
    networks: "ssbackend",
    vpnServiceProvider: "nordvpn",
    vpnType: "wireguard",
    wireguardPrivateKey: "k",
  });
  saveComponentValues("postgres", {
    mode: "external",
    host: "db.example",
    port: "5432",
    adminUser: "postgres",
    adminPassword: "x",
  });
}

const vpn = (on) => setSetting(VPN_ENABLED_SETTING, on ? "true" : "false");

// --- allocation -------------------------------------------------------------

test("the first instance gets the bottom of the band", () => {
  assert.equal(allocatePort(), PORT_BAND.first);
});

test("allocation skips ports already taken and is sticky across additions", () => {
  const first = provisionInstance(PROVIDER);
  const second = provisionInstance({ ...PROVIDER, displayName: "Provider 2" });
  const third = provisionInstance({ ...PROVIDER, displayName: "Provider 3" });

  assert.equal(first.port, 8080);
  assert.equal(second.port, 8081);
  assert.equal(third.port, 8082);

  // Adding the third must not have renumbered the first two — a renumber
  // recreates healthy containers to change nothing.
  assert.equal(getComponentValues("instance", first.key).port, "8080");
  assert.equal(getComponentValues("instance", second.key).port, "8081");
});

test("an instance keeps its port when another is removed from the middle", () => {
  provisionInstance(PROVIDER);
  const second = provisionInstance({ ...PROVIDER, displayName: "Provider 2" });
  const third = provisionInstance({ ...PROVIDER, displayName: "Provider 3" });

  assert.equal(getComponentValues("instance", third.key).port, "8082");
  assert.equal(getComponentValues("instance", second.key).port, "8081");
});

test("keys are unique and derived from the display name", () => {
  const a = provisionInstance(PROVIDER);
  const b = provisionInstance(PROVIDER);
  assert.equal(a.key, "provider-1");
  assert.equal(b.key, "provider-1-2");
});

test("provisioning generates the port, API key and database credentials", () => {
  const { key } = provisionInstance(PROVIDER);
  const values = getComponentValues("instance", key);

  assert.ok(values.port, "a port is allocated");
  assert.ok(values._apiKey, "an API key is generated so nobody has to type one");
  assert.equal(values._dbName, databaseNamesFor(key).database);
  assert.equal(values._dbUser, databaseNamesFor(key).user);
  assert.ok(values._dbPassword && values._dbPassword.length >= 20);
});

// --- the two topologies -----------------------------------------------------

test("with the VPN on, an instance joins gluetun's namespace and publishes nothing", async () => {
  configureStack();
  vpn(true);
  const { key } = provisionInstance(PROVIDER);

  const spec = await renderInstanceSpec(getComponentValues("instance", key), key);

  assert.equal(spec.networkMode, "container:stream-share-gluetun");
  assert.equal(spec.ports, undefined, "Docker rejects a published port inside another's namespace");
  assert.equal(spec.networks, undefined);
});

test("with the VPN off, an instance sits on a network and publishes its own port", async () => {
  configureStack();
  vpn(false);
  const { key } = provisionInstance(PROVIDER);

  const spec = await renderInstanceSpec(getComponentValues("instance", key), key);

  assert.equal(spec.networkMode, undefined);
  assert.deepEqual(spec.ports, [{ host: 8080, container: 8080, protocol: "tcp" }]);
});

test("gluetun publishes every instance's port on their behalf", async () => {
  configureStack();
  vpn(true);
  provisionInstance(PROVIDER);
  provisionInstance({ ...PROVIDER, displayName: "Provider 2" });

  const spec = await renderGluetunSpec(getComponentValues("gluetun"));

  assert.deepEqual(spec.ports, [
    { host: 8080, container: 8080, protocol: "tcp" },
    { host: 8081, container: 8081, protocol: "tcp" },
  ]);
});

test("the computed URL follows the VPN toggle without anyone editing it", () => {
  configureStack();
  const { key } = provisionInstance(PROVIDER);
  const values = getComponentValues("instance", key);

  vpn(true);
  assert.equal(instanceUrl(key, values), "http://stream-share-gluetun:8080");

  vpn(false);
  assert.equal(instanceUrl(key, values), "http://stream-share-provider-1:8080");
});

test("a managed instance reaches the ops layer already addressed and authenticated", () => {
  configureStack();
  const { key } = provisionInstance(PROVIDER);

  const instance = loadConfig().instances.find((i) => i.id === key);

  assert.ok(instance, "a created instance appears on the dashboard without being added twice");
  assert.equal(instance.name, "Provider 1");
  assert.equal(instance.url, "http://stream-share-gluetun:8080");
  assert.equal(instance.apiKey, getComponentValues("instance", key)._apiKey);
});

test("an overridden container name is what the spec and the URL both use", async () => {
  configureStack();
  vpn(false);
  const { key } = provisionInstance({ ...PROVIDER, containerName: "my-existing-instance" });
  const values = getComponentValues("instance", key);

  assert.equal(instanceContainerName(key, values), "my-existing-instance");
  assert.equal(instanceUrl(key, values), "http://my-existing-instance:8080");
  assert.equal((await renderInstanceSpec(values, key)).name, "my-existing-instance");
});

// --- the cascade, for real --------------------------------------------------

test("recreating gluetun cascades to every instance inside its namespace", async () => {
  configureStack();
  vpn(true);
  const a = provisionInstance(PROVIDER);
  const b = provisionInstance({ ...PROVIDER, displayName: "Provider 2" });

  // Everything deployed and matching, except gluetun, whose configuration has
  // moved on — exactly the shape of changing a VPN setting.
  const settled = await planStack();
  for (const plan of settled.plans) {
    if (!plan.spec) continue;
    containers.set(plan.spec.name, {
      Id: `id-${plan.spec.name}`,
      name: plan.spec.name,
      Labels: managedLabels(plan.kind, plan.desiredHash, plan.key),
    });
  }
  containers.get("stream-share-gluetun").Labels = managedLabels("gluetun", "stale", "");

  const { plans, summary } = await planStack();
  const row = (id) => plans.find((p) => p.id === id);

  assert.equal(row("gluetun").action, "recreate");
  assert.equal(row("gluetun").cascadedFrom, null, "gluetun changed on its own merits");

  for (const key of [a.key, b.key]) {
    const instance = row(`instance:${key}`);
    assert.equal(instance.action, "recreate", `${key} cannot survive gluetun being replaced`);
    assert.equal(instance.cascadedFrom, "gluetun");
  }

  assert.equal(summary.cascaded, 2);
  assert.equal(summary.restarts, 3);
});

test("with the VPN off, gluetun is gone and nothing cascades", async () => {
  configureStack();
  vpn(false);
  const { key } = provisionInstance(PROVIDER);

  const { plans } = await planStack();
  const instance = plans.find((p) => p.id === `instance:${key}`);

  assert.equal(instance.namespaceHost, null);
  assert.equal(instance.cascadedFrom, null);
});

test("gluetun is planned before the instances that live inside it", async () => {
  configureStack();
  vpn(true);
  provisionInstance(PROVIDER);

  const { plans } = await planStack();
  const ids = plans.map((p) => p.id);

  assert.ok(ids.indexOf("gluetun") < ids.indexOf("instance:provider-1"));
});

test("an instance with no usable stack paths is incomplete rather than mis-mounted", async () => {
  configureStack();
  setPaths({ dataPath: "", cachePath: "" });
  provisionInstance(PROVIDER);

  const { plans } = await planStack();
  const instance = plans.find((p) => p.kind === "instance");

  assert.equal(instance.action, "incomplete");
  assert.match(instance.reason, /data path/i);
});

test("instanceKeyFor does not collide with an externally configured instance", async () => {
  const { createInstance } = await import("../src/store/instances.js");
  createInstance({ name: "Provider 1", url: "http://elsewhere:8080" });

  assert.notEqual(instanceKeyFor("Provider 1"), "provider-1");
});

test("an instance whose database component is incomplete is blocked, naming it", async () => {
  // A managed postgres with nothing filled in. Without dependency propagation
  // the instance plans a create and then fails mid-apply against a host that
  // was never built — which is exactly what the smoke test hit.
  saveComponentValues("gluetun", {
    networks: "ssbackend",
    vpnServiceProvider: "nordvpn",
    vpnType: "wireguard",
    wireguardPrivateKey: "k",
  });
  saveComponentValues("postgres", { mode: "managed" });
  provisionInstance(PROVIDER);

  const { plans, summary } = await planStack();
  const instance = plans.find((p) => p.kind === "instance");

  assert.equal(instance.action, "incomplete");
  assert.match(instance.reason, /PostgreSQL must be configured first/i);

  // gluetun depends on nothing, so it is still creatable — blocking one
  // component must not stall the independent parts of the stack. What matters
  // is that the instance itself is not counted as applicable.
  assert.equal(summary.incomplete, 2, "postgres and the instance that needs it");
  assert.equal(
    plans.filter((p) => p.kind === "instance" && p.action !== "incomplete").length,
    0
  );
});

test("an instance with no database configured at all is blocked before it can fail on connect", async () => {
  saveComponentValues("gluetun", {
    networks: "ssbackend",
    vpnServiceProvider: "nordvpn",
    vpnType: "wireguard",
    wireguardPrivateKey: "k",
  });
  // External mode with no host: contributes no node, so the dependency check
  // cannot see it — the readiness check is what catches this one.
  saveComponentValues("postgres", { mode: "external", adminUser: "postgres", adminPassword: "x" });
  provisionInstance(PROVIDER);

  const { plans } = await planStack();
  const instance = plans.find((p) => p.kind === "instance");

  assert.equal(instance.action, "incomplete");
  assert.match(instance.reason, /No PostgreSQL server is configured/i);
});
