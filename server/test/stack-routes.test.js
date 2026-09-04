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
import { saveComponentValues, getComponentValues } from "../src/store/components.js";
import { provisionInstance } from "../src/reconcile/provisioning.js";

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
  // Postgres is managed by default and would add a row to every plan these
  // cases assert on; they are about gluetun and the routes themselves, so it
  // is pointed at an external server and drops out of the stack.
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

function routeDocker(method, url, res, body) {
  if (url.pathname === "/v1.43/_ping") return res.writeHead(200).end();

  // Orphan detection lists by label — honour the filter so nothing passes by
  // accident on an unfiltered list.
  if (method === "GET" && url.pathname === "/v1.43/containers/json") {
    const filters = JSON.parse(url.searchParams.get("filters") || "{}");
    const wanted = filters.label || [];
    const matches = [...containers.values()].filter((c) =>
      wanted.every((pair) => {
        const [k, v] = pair.split("=");
        return (c.Labels || {})[k] === v;
      })
    );
    return json(
      res,
      200,
      matches.map((c) => ({ Id: c.Id, Names: [`/${c.name}`], Image: c.Image || "", Labels: c.Labels }))
    );
  }

  const m = url.pathname.match(/^\/v1\.43\/containers\/([^/]+)(\/(json|start|stop))?$/);
  if (m) {
    const idOrName = decodeURIComponent(m[1]);
    const action = m[3];
    const container = containers.get(idOrName) || [...containers.values()].find((c) => c.Id === idOrName);

    if (method === "GET" && action === "json") {
      if (!container) return json(res, 404, { message: "No such container" });
      return json(res, 200, {
        Id: container.Id,
        Name: `/${container.name}`,
        Config: { Labels: container.Labels, Image: container.Image || "", Env: container.Env || [] },
        NetworkSettings: { Networks: container.Networks || {} },
      });
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

  if (method === "POST" && url.pathname === "/v1.43/images/create") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ status: "Status: Downloaded newer image" }));
  }

  if (method === "GET" && /^\/v1\.43\/images\/[^/]+\/json$/.test(url.pathname)) {
    return json(res, 200, { Id: "sha256:pulled" });
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

test("saving gluetun generates a control-server API key once, and keeps it stable on later saves", async () => {
  const c = await signedInClient(base);
  await c.put("/api/stack/components/gluetun", GLUETUN_VALUES);

  const firstKey = getComponentValues("gluetun")._controlServerApiKey;
  assert.ok(firstKey, "expected a control-server API key to be generated");

  await c.put("/api/stack/components/gluetun", { ...GLUETUN_VALUES, containerName: "my-gluetun" });
  assert.equal(getComponentValues("gluetun")._controlServerApiKey, firstKey);

  // Never exposed through the API — same write-only convention as any
  // other generated credential in this codebase.
  const read = await c.get("/api/stack/components/gluetun");
  assert.equal(JSON.stringify(read.body).includes(firstKey), false);
});

test("history is empty right after the first save, then gains an entry on the next real change", async () => {
  const c = await signedInClient(base);
  await c.put("/api/stack/components/gluetun", GLUETUN_VALUES);

  const first = await c.get("/api/stack/components/gluetun/history");
  assert.deepEqual(first.body.history, []);

  await c.put("/api/stack/components/gluetun", { ...GLUETUN_VALUES, containerName: "renamed" });
  const second = await c.get("/api/stack/components/gluetun/history");
  assert.equal(second.body.history.length, 1);
  assert.ok(second.body.history[0].id);
  assert.ok(second.body.history[0].created_at);
  // Never the raw config_json — same write-only convention as the current
  // values, which are also only ever projected through toPublicFields.
  assert.equal("config_json" in second.body.history[0], false);
});

test("restoring a history entry brings back its values, without touching Docker", async () => {
  const c = await signedInClient(base);
  await c.put("/api/stack/components/gluetun", GLUETUN_VALUES);
  await c.put("/api/stack/components/gluetun", { ...GLUETUN_VALUES, containerName: "renamed" });

  const { history } = (await c.get("/api/stack/components/gluetun/history")).body;
  const restoreRes = await c.post(`/api/stack/components/gluetun/history/${history[0].id}/restore`, {});
  assert.equal(restoreRes.status, 200);

  const fields = restoreRes.body.fields;
  assert.notEqual(fields.find((f) => f.key === "containerName").value, "renamed");
  assert.equal(containers.size, 0, "restoring a saved value must never touch Docker");
});

test("restoring an unknown history id is a 404", async () => {
  const c = await signedInClient(base);
  await c.put("/api/stack/components/gluetun", GLUETUN_VALUES);
  const res = await c.post("/api/stack/components/gluetun/history/999999/restore", {});
  assert.equal(res.status, 404);
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
  assert.ok(containers.has("streamshare-suite-gluetun"));
});

test("pull returns a job id immediately and pulls before creating on a fresh install", async () => {
  const c = await signedInClient(base);
  await c.put("/api/stack/components/gluetun", GLUETUN_VALUES);

  const pullRes = await c.post("/api/stack/components/gluetun/pull", {});
  assert.equal(pullRes.status, 202);
  assert.ok(pullRes.body.jobId);

  const job = await waitForJob(c, pullRes.body.jobId);
  assert.equal(job.status, "success");
  assert.ok(job.log.some((l) => l.line.includes("Pulling")));
  assert.ok(containers.has("streamshare-suite-gluetun"));
});

test("pull on an unconfigured component is a 400, not a crash", async () => {
  const c = await signedInClient(base);
  const res = await c.post("/api/stack/components/gluetun/pull", {});
  assert.equal(res.status, 400);
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
  containers.set("streamshare-suite-gluetun", { Id: "foreign-id", name: "streamshare-suite-gluetun", Labels: {} });

  const c = await signedInClient(base);
  await c.put("/api/stack/components/gluetun", GLUETUN_VALUES);

  const applyRes = await c.post("/api/stack/components/gluetun/apply", {});
  const job = await waitForJob(c, applyRes.body.jobId);

  assert.equal(job.status, "success");
  assert.ok(job.log.some((l) => /adopting without recreating/i.test(l.line)));
  assert.equal(containers.get("streamshare-suite-gluetun").Id, "foreign-id"); // untouched
});

test("stack endpoints require authentication, same as everything else behind the gate", async () => {
  const res = await apiClient(base).get("/api/stack/components/gluetun");
  assert.equal(res.status, 401);
});

// --- stack-level plan and apply ---------------------------------------------

test("the stack plan is ordered, summarised, and free of secret values", async () => {
  const c = await signedInClient(base);
  await c.put("/api/stack/components/gluetun", GLUETUN_VALUES);

  const res = await c.get("/api/stack/plan");

  assert.equal(res.status, 200);
  assert.equal(res.body.plans.length, 1);
  assert.equal(res.body.plans[0].action, "create");
  assert.equal(res.body.summary.changes, 1);
  assert.equal(res.body.vpnEnabled, true);
  assert.equal(
    JSON.stringify(res.body).includes("a-real-key"),
    false,
    "a plan must never echo a secret it rendered into the spec"
  );
});

test("an unconfigured stack plans as incomplete rather than failing", async () => {
  const c = await signedInClient(base);
  const res = await c.get("/api/stack/plan");

  assert.equal(res.status, 200);
  assert.equal(res.body.plans[0].action, "incomplete");
  assert.equal(res.body.summary.changes, 0);
});

test("applying the stack creates the container and reports through the job log", async () => {
  const c = await signedInClient(base);
  await c.put("/api/stack/components/gluetun", GLUETUN_VALUES);

  const started = await c.post("/api/stack/apply", {});
  assert.equal(started.status, 202);

  const job = await waitForJob(c, started.body.jobId);
  assert.equal(job.status, "success");
  assert.ok(containers.get("streamshare-suite-gluetun"), "expected the container to exist after applying");
  assert.ok(job.log.some((l) => /1\/1/.test(l.line)), "expected progress through the ordered plan");
});

test("applying a stack with nothing to do says so instead of touching Docker", async () => {
  const c = await signedInClient(base);
  await c.put("/api/stack/components/gluetun", GLUETUN_VALUES);
  await waitForJob(c, (await c.post("/api/stack/apply", {})).body.jobId);

  const second = await waitForJob(c, (await c.post("/api/stack/apply", {})).body.jobId);
  assert.equal(second.status, "success");
  assert.ok(second.log.some((l) => /nothing to apply/i.test(l.line)));
});

// --- the VPN toggle ---------------------------------------------------------

test("the VPN is on by default, which is what a phase 1 deployment already had", async () => {
  const c = await signedInClient(base);
  assert.equal((await c.get("/api/stack/settings")).body.vpnEnabled, true);
});

test("settings exposes the container prefix read-only, for the UI to preview a default name with", async () => {
  const c = await signedInClient(base);
  assert.equal((await c.get("/api/stack/settings")).body.containerPrefix, "streamshare-suite-");

  // Not settable through the route — it only ever reads SUITE_CONTAINER_PREFIX.
  const res = await c.put("/api/stack/settings", { containerPrefix: "ignored-" });
  assert.equal(res.body.containerPrefix, "streamshare-suite-");
});

test("the instance port range start defaults to 8080 and can be moved", async () => {
  const c = await signedInClient(base);
  assert.equal((await c.get("/api/stack/settings")).body.instancePortStart, 8080);

  const res = await c.put("/api/stack/settings", { instancePortStart: 9000 });
  assert.equal(res.status, 200);
  assert.equal(res.body.instancePortStart, 9000);
  assert.equal((await c.get("/api/stack/instances")).body.portBand.first, 9000);
});

test("an out-of-range instance port range start is rejected", async () => {
  const c = await signedInClient(base);
  for (const bad of [0, -1, 1.5, 65530, "not-a-number"]) {
    const res = await c.put("/api/stack/settings", { instancePortStart: bad });
    assert.equal(res.status, 400, `expected ${JSON.stringify(bad)} to be rejected`);
  }
  // Rejected, so the setting is untouched.
  assert.equal((await c.get("/api/stack/settings")).body.instancePortStart, 8080);
});

// --- editing an instance -----------------------------------------------------

const PROVIDER = {
  displayName: "Provider 1",
  xtreamBaseUrl: "http://provider.example:8080",
  xtreamUser: "u",
  xtreamPassword: "p",
  authMode: "basic",
  authUser: "viewer",
  authPassword: "secret",
};

test("editing an instance updates its stored fields", async () => {
  const c = await signedInClient(base);
  const { key } = provisionInstance(PROVIDER);

  const res = await c.put(`/api/stack/instances/${key}`, { ...PROVIDER, displayName: "Renamed" });
  assert.equal(res.status, 200);
  assert.equal(res.body.fields.find((f) => f.key === "displayName").value, "Renamed");
  assert.equal(getComponentValues("instance", key).displayName, "Renamed");
});

test("editing an instance never changes its key, even when the name changes", async () => {
  const c = await signedInClient(base);
  const { key } = provisionInstance(PROVIDER);

  await c.put(`/api/stack/instances/${key}`, { ...PROVIDER, displayName: "A whole new name" });
  assert.equal((await c.get("/api/stack/instances")).body.instances.length, 1);
  assert.equal((await c.get("/api/stack/instances")).body.instances[0].key, key);
});

test("leaving a secret field blank on edit keeps the stored value", async () => {
  const c = await signedInClient(base);
  const { key } = provisionInstance(PROVIDER);

  await c.put(`/api/stack/instances/${key}`, { ...PROVIDER, xtreamPassword: undefined });
  assert.equal(getComponentValues("instance", key).xtreamPassword, "p");
});

test("editing an instance's port to one already used by another is rejected", async () => {
  const c = await signedInClient(base);
  const first = provisionInstance(PROVIDER);
  const second = provisionInstance({ ...PROVIDER, displayName: "Provider 2" });
  assert.notEqual(first.port, second.port);

  const res = await c.put(`/api/stack/instances/${second.key}`, { ...PROVIDER, port: String(first.port) });
  assert.equal(res.status, 400);
  assert.match(res.body.errors[0].message, new RegExp(`already used by ${first.key}`));
  // Rejected, so the second instance's own port is untouched.
  assert.equal(Number(getComponentValues("instance", second.key).port), second.port);
});

test("editing an instance's port to the one it already has is not a clash with itself", async () => {
  const c = await signedInClient(base);
  const { key, port } = provisionInstance(PROVIDER);

  const res = await c.put(`/api/stack/instances/${key}`, { ...PROVIDER, port: String(port) });
  assert.equal(res.status, 200);
});

test("editing an unknown instance is a 404", async () => {
  const c = await signedInClient(base);
  const res = await c.put("/api/stack/instances/does-not-exist", PROVIDER);
  assert.equal(res.status, 404);
});

// --- import from running containers -----------------------------------------

test("import candidates lists a real container by kind, and excludes an already-managed one", async () => {
  containers.set("real-gluetun", { Id: "g1", name: "real-gluetun", Image: "qmcgaw/gluetun:latest", Labels: {} });
  containers.set("real-db", { Id: "p1", name: "real-db", Image: "postgres:14-alpine", Labels: {} });
  containers.set("nginx", { Id: "n1", name: "nginx", Image: "nginx:latest", Labels: {} });

  const c = await signedInClient(base);
  const res = await c.get("/api/stack/import/candidates");
  assert.equal(res.status, 200);
  const byName = Object.fromEntries(res.body.candidates.map((cand) => [cand.name, cand.kind]));
  assert.equal(byName["real-gluetun"], "gluetun");
  assert.equal(byName["real-db"], "postgres");
  assert.equal("nginx" in byName, false);
});

test("importing a candidate saves its configuration and reports what it created", async () => {
  containers.set("real-gluetun", {
    Id: "g1",
    name: "real-gluetun",
    Image: "qmcgaw/gluetun:latest",
    Env: ["VPN_SERVICE_PROVIDER=nordvpn"],
    Labels: {},
  });

  const c = await signedInClient(base);
  const res = await c.post("/api/stack/import", { containerId: "g1", kind: "gluetun" });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { kind: "gluetun", key: "" });

  const fields = (await c.get("/api/stack/components/gluetun")).body.fields;
  assert.equal(fields.find((f) => f.key === "vpnServiceProvider").value, "nordvpn");
  assert.equal(fields.find((f) => f.key === "containerName").value, "real-gluetun");
});

test("importing without containerId or kind is a 400", async () => {
  const c = await signedInClient(base);
  assert.equal((await c.post("/api/stack/import", { kind: "gluetun" })).status, 400);
  assert.equal((await c.post("/api/stack/import", { containerId: "g1" })).status, 400);
});

test("importing an unknown container id surfaces the reconciler's own error", async () => {
  const c = await signedInClient(base);
  const res = await c.post("/api/stack/import", { containerId: "does-not-exist", kind: "gluetun" });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /No container found/);
});

test("switching the VPN off takes gluetun out of the stack plan", async () => {
  const c = await signedInClient(base);
  await c.put("/api/stack/components/gluetun", GLUETUN_VALUES);

  await c.put("/api/stack/settings", { vpnEnabled: false });

  const res = await c.get("/api/stack/plan");
  assert.equal(res.body.vpnEnabled, false);
  assert.equal(res.body.plans.filter((p) => p.action !== "orphaned").length, 0);
});

test("a switched-off component is still configurable, just not plannable", async () => {
  const c = await signedInClient(base);
  await c.put("/api/stack/settings", { vpnEnabled: false });

  assert.equal((await c.put("/api/stack/components/gluetun", GLUETUN_VALUES)).status, 200);
  assert.equal((await c.get("/api/stack/components/gluetun")).body.active, false);
  assert.equal((await c.get("/api/stack/components/gluetun/plan")).status, 409);
  assert.equal((await c.post("/api/stack/components/gluetun/apply", {})).status, 409);
});

// --- orphans ----------------------------------------------------------------

test("a container left behind by switching the VPN off is reported and then removable", async () => {
  const c = await signedInClient(base);
  await c.put("/api/stack/components/gluetun", GLUETUN_VALUES);
  await waitForJob(c, (await c.post("/api/stack/apply", {})).body.jobId);
  assert.ok(containers.get("streamshare-suite-gluetun"));

  await c.put("/api/stack/settings", { vpnEnabled: false });

  const planned = await c.get("/api/stack/plan");
  const orphan = planned.body.plans.find((p) => p.action === "orphaned");
  assert.ok(orphan, "expected the container to be reported as orphaned");

  // Applying must not remove it — that is deliberately a separate action.
  await waitForJob(c, (await c.post("/api/stack/apply", {})).body.jobId);
  assert.ok(containers.get("streamshare-suite-gluetun"), "apply must never remove an orphan");

  const removal = await c.post("/api/stack/orphans/remove", { containerId: orphan.containerId });
  assert.equal(removal.status, 202);
  const job = await waitForJob(c, removal.body.jobId);
  assert.equal(job.status, "success");
  assert.equal(containers.get("streamshare-suite-gluetun"), undefined);
});

test("removing an orphan without a container id is a 400", async () => {
  const c = await signedInClient(base);
  assert.equal((await c.post("/api/stack/orphans/remove", {})).status, 400);
});

test("the stack-level routes are behind the auth gate like everything else", async () => {
  const anon = apiClient(base);
  await signedInClient(base); // an account must exist, or setup answers instead of the gate

  for (const path of ["/api/stack/plan", "/api/stack/settings"]) {
    assert.equal((await anon.get(path)).status, 401, `${path} must not answer anonymously`);
  }
  assert.equal((await anon.post("/api/stack/apply", {})).status, 401);
  assert.equal((await anon.post("/api/stack/orphans/remove", { containerId: "x" })).status, 401);
});

test("an adopted container stays visible in the plan when its component is switched off", async () => {
  const c = await signedInClient(base);
  await c.put("/api/stack/components/gluetun", GLUETUN_VALUES);

  // A container from someone's own compose file: no Suite labels.
  containers.set("streamshare-suite-gluetun", {
    Id: "hand-written",
    name: "streamshare-suite-gluetun",
    Labels: {},
  });
  assert.equal((await c.get("/api/stack/plan")).body.plans[0].action, "adopt");

  await c.put("/api/stack/settings", { vpnEnabled: false });

  const res = await c.get("/api/stack/plan");
  assert.equal(res.body.plans.length, 1, "the plan must not go empty while the container runs");
  assert.equal(res.body.plans[0].action, "disabled");
  assert.equal(res.body.summary.changes, 0);
});

test("applying never touches a container belonging to a switched-off component", async () => {
  const c = await signedInClient(base);
  await c.put("/api/stack/components/gluetun", GLUETUN_VALUES);
  containers.set("streamshare-suite-gluetun", { Id: "hand-written", name: "streamshare-suite-gluetun", Labels: {} });
  await c.put("/api/stack/settings", { vpnEnabled: false });

  const job = await waitForJob(c, (await c.post("/api/stack/apply", {})).body.jobId);
  assert.equal(job.status, "success");
  assert.equal(containers.get("streamshare-suite-gluetun").Id, "hand-written");
});
