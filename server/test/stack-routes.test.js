// End-to-end over real HTTP for /api/stack: schema-driven config, planning,
// and applying as a background job — against a fake Docker daemon so the
// whole chain (route -> reconciler -> Docker client) is proven together.

import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { freshDatabase, apiClient, signedInClient } from "./helpers.js";
import { createApp } from "../src/app.js";
import { _resetLoginThrottle } from "../src/auth/middleware.js";
import { _clearJobsForTests } from "../src/reconcile/jobs.js";

let appServer;
let base;
let dockerServer;
let containers;
let nextId;

before(async () => {
  appServer = createApp({ serveStatic: false }).listen(0);
  await new Promise((resolve) => appServer.once("listening", resolve));
  base = `http://127.0.0.1:${appServer.address().port}`;

  dockerServer = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => routeDocker(req.method, url, res, body));
  });
  await new Promise((resolve) => dockerServer.listen(0, resolve));
  process.env.DOCKER_PROXY_URL = `http://127.0.0.1:${dockerServer.address().port}`;
});

after(() => {
  appServer.close();
  dockerServer.close();
});

beforeEach(() => {
  freshDatabase();
  _resetLoginThrottle();
  _clearJobsForTests();
  containers = new Map();
  nextId = 1;
});

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function routeDocker(method, url, res, body) {
  if (url.pathname === "/v1.43/_ping") return res.writeHead(200).end();

  const m = url.pathname.match(/^\/v1\.43\/containers\/([^/]+)(\/(json|start|stop))?$/);
  if (m) {
    const idOrName = decodeURIComponent(m[1]);
    const action = m[3];
    const container = containers.get(idOrName) || [...containers.values()].find((c) => c.Id === idOrName);

    if (method === "GET" && action === "json") {
      if (!container) return json(res, 404, { message: "No such container" });
      return json(res, 200, { Id: container.Id, Config: { Labels: container.Labels } });
    }
    if (method === "POST" && (action === "start" || action === "stop")) {
      if (!container) return json(res, 404, { message: "No such container" });
      return res.writeHead(204).end();
    }
    if (method === "DELETE" && !action) {
      if (!container) return res.writeHead(404).end();
      containers.delete(container.name);
      return res.writeHead(204).end();
    }
  }

  if (method === "POST" && url.pathname === "/v1.43/containers/create") {
    const name = url.searchParams.get("name");
    const payload = JSON.parse(body);
    const id = `id-${nextId++}`;
    containers.set(name, { Id: id, name, Labels: payload.Labels || {} });
    return json(res, 201, { Id: id, Warnings: [] });
  }

  if (method === "POST" && /^\/v1\.43\/networks\/[^/]+\/connect$/.test(url.pathname)) {
    return res.writeHead(200).end();
  }

  json(res, 500, { message: `unhandled ${method} ${url.pathname}` });
}

async function waitForJob(client, jobId, { timeoutMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { body } = await client.get(`/api/stack/jobs/${jobId}`);
    if (body.status !== "running") return body;
    if (Date.now() > deadline) throw new Error("job did not finish in time");
    await new Promise((r) => setTimeout(r, 10));
  }
}

const GLUETUN_VALUES = {
  networks: "ssbackend",
  vpnServiceProvider: "nordvpn",
  vpnType: "wireguard",
  wireguardPrivateKey: "a-real-key",
};

test("an unknown component kind is a 404, not a crash", async () => {
  const c = await signedInClient(base);
  assert.equal((await c.get("/api/stack/components/bogus")).status, 404);
  assert.equal((await c.put("/api/stack/components/bogus", {})).status, 404);
  assert.equal((await c.get("/api/stack/components/bogus/plan")).status, 404);
});

test("the schema's gluetun secret is write-only through the API, same as everywhere else", async () => {
  const c = await signedInClient(base);
  await c.put("/api/stack/components/gluetun", GLUETUN_VALUES);

  const read = await c.get("/api/stack/components/gluetun");
  const secretField = read.body.fields.find((f) => f.key === "wireguardPrivateKey");
  assert.equal(secretField.valueSet, true);
  assert.equal(JSON.stringify(read.body).includes("a-real-key"), false);
});

test("saving rejects an incomplete configuration with field-level errors", async () => {
  const c = await signedInClient(base);
  const res = await c.put("/api/stack/components/gluetun", { vpnServiceProvider: "nordvpn" });
  assert.equal(res.status, 400);
  assert.ok(res.body.errors.length > 0);
});

test("plan is a 400 with incomplete:true when required fields are missing, and makes no Docker calls", async () => {
  const c = await signedInClient(base);
  const res = await c.get("/api/stack/components/gluetun/plan");
  assert.equal(res.status, 400);
  assert.equal(res.body.incomplete, true);
});

test("plan reports 'create' for a fresh, complete configuration, with env values redacted to keys only", async () => {
  const c = await signedInClient(base);
  await c.put("/api/stack/components/gluetun", GLUETUN_VALUES);

  const res = await c.get("/api/stack/components/gluetun/plan");
  assert.equal(res.status, 200);
  assert.equal(res.body.action, "create");
  assert.ok(Array.isArray(res.body.spec.env));
  assert.ok(res.body.spec.env.includes("VPN_SERVICE_PROVIDER"));
  assert.equal(JSON.stringify(res.body).includes("a-real-key"), false);
});

test("apply returns a job id immediately and the job reaches success", async () => {
  const c = await signedInClient(base);
  await c.put("/api/stack/components/gluetun", GLUETUN_VALUES);

  const applyRes = await c.post("/api/stack/components/gluetun/apply", {});
  assert.equal(applyRes.status, 202);
  assert.ok(applyRes.body.jobId);

  const job = await waitForJob(c, applyRes.body.jobId);
  assert.equal(job.status, "success");
  assert.ok(job.log.some((l) => l.line.includes("Creating")));
  assert.ok(containers.has("stream-share-gluetun"));
});

test("a second apply with an unchanged configuration reaches a noop success", async () => {
  const c = await signedInClient(base);
  await c.put("/api/stack/components/gluetun", GLUETUN_VALUES);

  const first = await c.post("/api/stack/components/gluetun/apply", {});
  await waitForJob(c, first.body.jobId);

  const second = await c.post("/api/stack/components/gluetun/apply", {});
  const job = await waitForJob(c, second.body.jobId);
  assert.equal(job.status, "success");
  assert.ok(job.log.some((l) => /already matches/.test(l.line)));
});

test("apply refuses an incomplete configuration rather than starting a job", async () => {
  const c = await signedInClient(base);
  const res = await c.post("/api/stack/components/gluetun/apply", {});
  assert.equal(res.status, 400);
});

test("polling an unknown job id is a 404", async () => {
  const c = await signedInClient(base);
  assert.equal((await c.get("/api/stack/jobs/00000000-0000-0000-0000-000000000000")).status, 404);
});

test("apply on an unmanaged existing container adopts it without a Docker mutation", async () => {
  containers.set("stream-share-gluetun", { Id: "foreign-id", name: "stream-share-gluetun", Labels: {} });

  const c = await signedInClient(base);
  await c.put("/api/stack/components/gluetun", GLUETUN_VALUES);

  const applyRes = await c.post("/api/stack/components/gluetun/apply", {});
  const job = await waitForJob(c, applyRes.body.jobId);

  assert.equal(job.status, "success");
  assert.ok(job.log.some((l) => /adopting without recreating/i.test(l.line)));
  assert.equal(containers.get("stream-share-gluetun").Id, "foreign-id"); // untouched
});

test("stack endpoints require authentication, same as everything else behind the gate", async () => {
  const res = await apiClient(base).get("/api/stack/components/gluetun");
  assert.equal(res.status, 401);
});
