// End-to-end over real HTTP: the route resolves the right instance, forwards
// the query, and never turns a provider hiccup into a crash — just an error
// status the wizard is expected to swallow.

import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { freshDatabase, signedInClient } from "./helpers.js";
import { createApp } from "../src/app.js";
import { _resetLoginThrottle } from "../src/auth/middleware.js";
import { createInstance } from "../src/store/instances.js";

let appServer;
let base;
let instanceServer;
let nextResponse;

before(async () => {
  appServer = createApp({ serveStatic: false }).listen(0);
  await new Promise((resolve) => appServer.once("listening", resolve));
  base = `http://127.0.0.1:${appServer.address().port}`;

  instanceServer = createServer((req, res) => {
    res.writeHead(nextResponse.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(nextResponse.body));
  });
  await new Promise((resolve) => instanceServer.listen(0, resolve));
});

after(() => {
  appServer.close();
  instanceServer.close();
});

beforeEach(() => {
  freshDatabase();
  _resetLoginThrottle();
  nextResponse = { status: 200, body: { success: true, data: [] } };
});

function addInstance() {
  return createInstance({
    name: "Main",
    url: `http://127.0.0.1:${instanceServer.address().port}`,
    apiKey: "k",
  });
}

test("returns matches from the instance's own search", async () => {
  const instance = addInstance();
  nextResponse = {
    status: 200,
    body: { success: true, data: [{ StreamID: "42", Name: "BBC One", Category: "UK" }] },
  };

  const client = await signedInClient(base);
  const res = await client.get(`/api/instances/${instance.id}/health-check/channels?q=bbc`);

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.results, [{ StreamID: "42", Name: "BBC One", Category: "UK" }]);
});

test("404s for an unknown instance", async () => {
  const client = await signedInClient(base);
  const res = await client.get("/api/instances/does-not-exist/health-check/channels?q=bbc");
  assert.equal(res.status, 404);
});

test("skips the instance call and returns no results for an empty query", async () => {
  const instance = addInstance();
  const client = await signedInClient(base);
  const res = await client.get(`/api/instances/${instance.id}/health-check/channels`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.results, []);
});

test("responds with an error status, not a crash, when the instance call fails", async () => {
  const instance = addInstance();
  nextResponse = { status: 502, body: { success: false, error: "provider unreachable" } };

  const client = await signedInClient(base);
  const res = await client.get(`/api/instances/${instance.id}/health-check/channels?q=bbc`);
  assert.equal(res.status, 502);
});
