// Drives the reconciler against a fake Docker daemon (a real HTTP server
// standing in for the socket proxy) so the full create/recreate/adopt/noop
// decision — and the actual request sequence each one issues — is proven,
// not just the pure planning logic.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { planComponent, applyPlan } from "../src/reconcile/reconciler.js";
import { computeSpecHash } from "../src/docker/spec.js";
import { managedLabels } from "../src/docker/labels.js";
import { freshDatabase } from "./helpers.js";

let server;
let requests;
let containers; // name -> { Id, Config: { Labels }, running: bool }
let nextId;

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      requests.push({ method: req.method, path: url.pathname, query: url.searchParams, body });
      route(req.method, url, res, body);
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  process.env.DOCKER_PROXY_URL = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

beforeEach(() => {
  freshDatabase();
  requests = [];
  containers = new Map();
  nextId = 1;
});

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// A minimal, stateful fake of just the endpoints the reconciler calls —
// enough to prove the sequence of calls it makes, not a full Docker daemon.
function route(method, url, res, body) {
  const containerMatch = url.pathname.match(/^\/v1\.43\/containers\/([^/]+)(\/(json|start|stop))?$/);

  if (method === "GET" && url.pathname === "/v1.43/containers/json") {
    return json(res, 200, []); // unused by the reconciler directly; inspect-by-name is used instead
  }

  if (containerMatch) {
    const idOrName = decodeURIComponent(containerMatch[1]);
    const action = containerMatch[3];
    const container = containers.get(idOrName) || [...containers.values()].find((c) => c.Id === idOrName);

    if (method === "GET" && action === "json") {
      if (!container) return json(res, 404, { message: "No such container" });
      return json(res, 200, {
        Id: container.Id,
        Config: { Labels: container.Config.Labels, Image: container.image || undefined },
        State: {
          Status: container.running ? "running" : "exited",
          Health: container.health ? { Status: container.health } : undefined,
          RestartCount: container.restartCount,
        },
      });
    }
    if (method === "POST" && action === "start") {
      if (!container) return json(res, 404, { message: "No such container" });
      container.running = true;
      res.writeHead(204).end();
      return;
    }
    if (method === "POST" && action === "stop") {
      if (!container) return json(res, 404, { message: "No such container" });
      container.running = false;
      res.writeHead(204).end();
      return;
    }
    if (method === "DELETE" && !action) {
      if (!container) {
        res.writeHead(404).end();
        return;
      }
      containers.delete(container.name);
      res.writeHead(204).end();
      return;
    }
  }

  if (method === "POST" && url.pathname === "/v1.43/containers/create") {
    const name = url.searchParams.get("name");
    const payload = JSON.parse(body);
    const id = `id-${nextId++}`;
    containers.set(name, { Id: id, name, Config: { Labels: payload.Labels || {} }, running: false });
    return json(res, 201, { Id: id, Warnings: [] });
  }

  if (method === "POST" && /^\/v1\.43\/networks\/[^/]+\/connect$/.test(url.pathname)) {
    res.writeHead(200).end();
    return;
  }

  json(res, 500, { message: `unhandled ${method} ${url.pathname}` });
}

const SPEC = {
  name: "stream-share-gluetun",
  image: "qmcgaw/gluetun:latest",
  env: { VPN_SERVICE_PROVIDER: "nordvpn" },
  capAdd: ["NET_ADMIN"],
  devices: ["/dev/net/tun:/dev/net/tun"],
  networks: ["ssbackend", "nordvpn"],
};

// The identity half of what planComponent needs; the catalog builds these for
// real, but the decision under test here is about the container, not the graph.
const NODE = {
  id: "gluetun",
  kind: "gluetun",
  key: "",
  label: "Gluetun (VPN)",
  namespaceHost: null,
};

function collectLog() {
  const lines = [];
  return { log: (line) => lines.push(line), lines };
}

test("plans 'create' when no container with the expected name exists", async () => {
  const plan = await planComponent(NODE, SPEC);
  assert.equal(plan.action, "create");
  assert.equal(plan.runtime, null);
});

test("applying a 'create' plan creates, joins the second network, and starts", async () => {
  const plan = await planComponent(NODE, SPEC);
  const { log, lines } = collectLog();

  const id = await applyPlan(plan, { log });

  const created = containers.get("stream-share-gluetun");
  assert.equal(created.Id, id);
  assert.equal(created.running, true);
  assert.equal(created.Config.Labels["streamshare.suite.managed"], "true");
  assert.equal(created.Config.Labels["streamshare.suite.spec-hash"], computeSpecHash(SPEC));

  const connectCall = requests.find((r) => r.path.includes("/networks/"));
  assert.ok(connectCall, "expected a network connect call for the second network");
  assert.match(connectCall.path, /\/networks\/nordvpn\/connect/);

  assert.ok(lines.some((l) => l.includes("Creating")));
  assert.ok(lines.some((l) => l.includes("Starting")));
});

test("plans 'noop' when a managed container already matches the desired spec hash", async () => {
  const hash = computeSpecHash(SPEC);
  containers.set("stream-share-gluetun", {
    Id: "existing",
    name: "stream-share-gluetun",
    Config: { Labels: managedLabels("gluetun", hash) },
    running: true,
  });

  const plan = await planComponent(NODE, SPEC);
  assert.equal(plan.action, "noop");
});

test("a noop plan's runtime reflects the live container's status, image, and health", async () => {
  const hash = computeSpecHash(SPEC);
  containers.set("stream-share-gluetun", {
    Id: "existing",
    name: "stream-share-gluetun",
    Config: { Labels: managedLabels("gluetun", hash) },
    running: true,
    image: "qmcgaw/gluetun:v3.40",
    health: "healthy",
    restartCount: 2,
  });

  const plan = await planComponent(NODE, SPEC);
  assert.deepEqual(plan.runtime, {
    status: "running",
    health: "healthy",
    restartCount: 2,
    image: "qmcgaw/gluetun:v3.40",
  });
});

test("a stopped container's runtime has no health when the image sets none", async () => {
  const hash = computeSpecHash(SPEC);
  containers.set("stream-share-gluetun", {
    Id: "existing",
    name: "stream-share-gluetun",
    Config: { Labels: managedLabels("gluetun", hash) },
    running: false,
  });

  const plan = await planComponent(NODE, SPEC);
  assert.equal(plan.runtime.status, "exited");
  assert.equal(plan.runtime.health, null);
});

test("applying a 'noop' plan makes no Docker calls beyond the inspect already used to plan", async () => {
  const hash = computeSpecHash(SPEC);
  containers.set("stream-share-gluetun", {
    Id: "existing",
    name: "stream-share-gluetun",
    Config: { Labels: managedLabels("gluetun", hash) },
    running: true,
  });

  const plan = await planComponent(NODE, SPEC);
  requests.length = 0; // only count calls made during apply, not during plan
  const { log } = collectLog();
  const id = await applyPlan(plan, { log });

  assert.equal(id, "existing");
  assert.equal(requests.length, 0);
});

test("plans 'recreate' when a managed container's spec hash has changed", async () => {
  containers.set("stream-share-gluetun", {
    Id: "existing",
    name: "stream-share-gluetun",
    Config: { Labels: managedLabels("gluetun", "stale-hash") },
    running: true,
  });

  const plan = await planComponent(NODE, SPEC);
  assert.equal(plan.action, "recreate");
  assert.equal(plan.previousHash, "stale-hash");
});

test("applying a 'recreate' plan stops and removes the old container before creating the new one", async () => {
  containers.set("stream-share-gluetun", {
    Id: "old-id",
    name: "stream-share-gluetun",
    Config: { Labels: managedLabels("gluetun", "stale-hash") },
    running: true,
  });

  const plan = await planComponent(NODE, SPEC);
  const { log } = collectLog();
  const newId = await applyPlan(plan, { log });

  assert.notEqual(newId, "old-id");
  const current = containers.get("stream-share-gluetun");
  assert.equal(current.Id, newId);
  assert.equal(current.Config.Labels["streamshare.suite.spec-hash"], computeSpecHash(SPEC));

  // stop must precede remove must precede create, in that order.
  const order = requests.map((r) => `${r.method} ${r.path}`);
  const stopIdx = order.findIndex((r) => r.includes("/old-id/stop"));
  const deleteIdx = order.findIndex((r) => r === "DELETE /v1.43/containers/old-id");
  const createIdx = order.findIndex((r) => r === "POST /v1.43/containers/create");
  assert.ok(stopIdx >= 0 && deleteIdx > stopIdx && createIdx > deleteIdx);
});

test("plans 'adopt' when a container exists under the name but carries none of our labels", async () => {
  containers.set("stream-share-gluetun", {
    Id: "foreign-id",
    name: "stream-share-gluetun",
    Config: { Labels: {} }, // the user's own hand-written compose container
    running: true,
  });

  const plan = await planComponent(NODE, SPEC);
  assert.equal(plan.action, "adopt");
  assert.equal(plan.containerId, "foreign-id");
});

test("applying an 'adopt' plan without takeover makes zero Docker calls and leaves the container untouched", async () => {
  containers.set("stream-share-gluetun", {
    Id: "foreign-id",
    name: "stream-share-gluetun",
    Config: { Labels: {} },
    running: true,
  });

  const plan = await planComponent(NODE, SPEC);
  requests.length = 0;
  const { log, lines } = collectLog();
  const id = await applyPlan(plan, { log, takeover: false });

  assert.equal(id, "foreign-id");
  assert.equal(requests.length, 0, "adopting must not touch the real container");
  assert.equal(containers.get("stream-share-gluetun").running, true);
  assert.ok(lines.some((l) => /adopting without recreating/i.test(l)));
});

test("adopting persists the adoption so a later plan can still see it", async () => {
  const { getComponentRow } = await import("../src/store/components.js");
  containers.set("stream-share-gluetun", {
    Id: "foreign-id",
    name: "stream-share-gluetun",
    Config: { Labels: {} },
    running: true,
  });

  const plan = await planComponent(NODE, SPEC);
  await applyPlan(plan, { log: () => {}, takeover: false });

  const row = getComponentRow("gluetun");
  assert.equal(row.adopted_container_id, "foreign-id");
});

test("applying an 'adopt' plan WITH takeover stops and removes the foreign container, then creates a managed one", async () => {
  containers.set("stream-share-gluetun", {
    Id: "foreign-id",
    name: "stream-share-gluetun",
    Config: { Labels: {} },
    running: true,
  });

  const plan = await planComponent(NODE, SPEC);
  const { log, lines } = collectLog();
  const newId = await applyPlan(plan, { log, takeover: true });

  assert.notEqual(newId, "foreign-id");
  const current = containers.get("stream-share-gluetun");
  assert.equal(current.Config.Labels["streamshare.suite.managed"], "true");
  assert.ok(lines.some((l) => /taking over/i.test(l)));

  const order = requests.map((r) => `${r.method} ${r.path}`);
  const stopIdx = order.findIndex((r) => r.includes("/foreign-id/stop"));
  const deleteIdx = order.findIndex((r) => r === "DELETE /v1.43/containers/foreign-id");
  const createIdx = order.findIndex((r) => r === "POST /v1.43/containers/create");
  assert.ok(stopIdx >= 0 && deleteIdx > stopIdx && createIdx > deleteIdx);
});
