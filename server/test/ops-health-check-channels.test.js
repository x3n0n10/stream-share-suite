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
import { provisionInstance } from "../src/reconcile/provisioning.js";
import { saveComponentValues, getComponentValues } from "../src/store/components.js";
import { VPN_ENABLED_SETTING } from "../src/reconcile/catalog.js";
import { setSetting } from "../src/store/settings.js";

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

// Unlike addInstance() above (an externally-added instance, store/instances.js),
// this seeds a Suite-managed ("stack component") instance the way provisioning
// actually creates one — the code path the wizard exclusively deals with,
// projected into config.instances by managedInstances() in config.js. VPN off
// is required so instanceUrl() builds the host from the instance's own
// containerName instead of gluetun's, which lets it be pointed at the local
// instanceServer without a real Docker network.
function addManagedInstance() {
  setSetting(VPN_ENABLED_SETTING, "false");
  const { key } = provisionInstance({ displayName: "Managed" });
  saveComponentValues(
    "instance",
    {
      ...getComponentValues("instance", key),
      containerName: "127.0.0.1",
      port: String(instanceServer.address().port),
    },
    key
  );
  return { id: key };
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

// Regression test for a real bug: an instance's own auth failure (wrong or
// revoked API key for THAT instance) must never come back as a 401 on this
// Suite's own response — the frontend treats any 401 from its own backend as
// "your Suite session expired" and logs the whole UI out, which has nothing
// to do with one instance's credentials.
test("never relays a 401 from the instance as this Suite's own 401 (would log the operator out)", async () => {
  const instance = addInstance();
  nextResponse = { status: 401, body: { error: "invalid API key" } };

  const client = await signedInClient(base);
  const res = await client.get(`/api/instances/${instance.id}/health-check/channels?q=bbc`);
  assert.equal(res.status, 502);
  assert.notEqual(res.status, 401);
});

test("resolves a Suite-managed (stack component) instance, the path the wizard actually uses", async () => {
  const instance = addManagedInstance();
  nextResponse = {
    status: 200,
    body: { success: true, data: [{ StreamID: "42", Name: "BBC One", Category: "UK" }] },
  };

  const client = await signedInClient(base);
  const res = await client.get(`/api/instances/${instance.id}/health-check/channels?q=bbc`);

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.results, [{ StreamID: "42", Name: "BBC One", Category: "UK" }]);
});
