// The sidebar badge's count: one cheap /status call per instance, summed.
// An instance that cannot answer is left out rather than failing the number.

import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { freshDatabase, apiClient, signedInClient } from "./helpers.js";
import { createApp } from "../src/app.js";
import { _resetLoginThrottle } from "../src/auth/middleware.js";
import { createInstance } from "../src/store/instances.js";

let appServer;
let base;
const instanceServers = [];

before(async () => {
  appServer = createApp({ serveStatic: false }).listen(0);
  await new Promise((resolve) => appServer.once("listening", resolve));
  base = `http://127.0.0.1:${appServer.address().port}`;
});

after(() => {
  appServer.close();
  instanceServers.forEach((s) => s.close());
});

beforeEach(() => {
  freshDatabase();
  _resetLoginThrottle();
});

// A stand-in stream-share instance that answers every path with `data`, or
// with `status` when that is not 200.
async function addInstance(name, { status = 200, ...data } = {}) {
  const server = createServer((req, res) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: status === 200, data }));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  instanceServers.push(server);
  createInstance({ name, url: `http://127.0.0.1:${server.address().port}`, apiKey: "k" });
}

test("adds up the active streams of every instance", async () => {
  const c = await signedInClient(base);
  await addInstance("One", { streams_count: 2 });
  await addInstance("Two", { streams_count: 3 });

  const res = await c.get("/api/active-streams");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { activeStreams: 5 });
});

test("an instance that errors is left out of the count", async () => {
  const c = await signedInClient(base);
  await addInstance("Up", { streams_count: 4 });
  await addInstance("Down", { streams_count: 9, status: 500 });

  assert.deepEqual((await c.get("/api/active-streams")).body, { activeStreams: 4 });
});

test("no instances means zero", async () => {
  const c = await signedInClient(base);
  assert.deepEqual((await c.get("/api/active-streams")).body, { activeStreams: 0 });
});

test("it needs a session like everything else", async () => {
  assert.equal((await apiClient(base).get("/api/active-streams")).status, 401);
});

test("a stream whose only viewers are lent is not counted", async () => {
  const c = await signedInClient(base);
  await addInstance("Main", { streams_count: 1, summary: [{ stream_id: "1", viewers: ["alice"], via: "Spare" }] });
  await addInstance("Spare", { streams_count: 2, summary: [
    { stream_id: "9", viewers: ["failover:Main/1"] },
    { stream_id: "8", viewers: ["bob", "failover:Main/2"] },
  ] });
  assert.deepEqual((await c.get("/api/active-streams")).body, { activeStreams: 2 });
});

test("overview leaves lent-only streams out of each instance's summary", async () => {
  const c = await signedInClient(base);
  await addInstance("Spare", { streams_count: 1, summary: [{ stream_id: "9", viewers: ["failover:Main/1"] }] });
  const res = await c.get("/api/overview");
  assert.deepEqual(res.body.instances[0].status.summary, []);
  assert.equal(res.body.instances[0].status.streams_count, 1); // cards keep the instance's own count
});
