// End-to-end over real HTTP: the share-link routes resolve the right instance,
// forward to its /api/internal/shares API with the right method, body and
// path, shape what comes back, and turn failures into statuses the page can
// act on (never a crash, never a Suite logout).

import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { freshDatabase, signedInClient, apiClient } from "./helpers.js";
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
let seen;

const RAW_SHARE = {
  token: "tok",
  stream_id: "42",
  title: "Eurosport 1",
  created_by: "discord-user",
  guest: "Bert",
  starts_at: "2026-10-31T20:00:00Z",
  ends_at: "2026-10-31T23:00:00Z",
  created_at: "2026-10-30T09:00:00Z",
  state: "active",
  urls: { playlist: "http://internal:8080/share/tok.m3u", stream: "http://internal:8080/share/tok/live.ts" },
};

before(async () => {
  appServer = createApp({ serveStatic: false }).listen(0);
  await new Promise((resolve) => appServer.once("listening", resolve));
  base = `http://127.0.0.1:${appServer.address().port}`;

  instanceServer = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      seen.push({
        method: req.method,
        url: req.url,
        apiKey: req.headers["x-api-key"],
        body: raw ? JSON.parse(raw) : undefined,
      });
      res.writeHead(nextResponse.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(nextResponse.body));
    });
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
  seen = [];
  nextResponse = { status: 200, body: { success: true, data: [] } };
});

// An instance typed in by hand: the Suite knows its address and key, nothing else.
function addInstance() {
  return createInstance({
    name: "Main",
    url: `http://127.0.0.1:${instanceServer.address().port}`,
    apiKey: "k",
  });
}

// A Suite-managed instance, seeded the way provisioning creates one (see
// ops-health-check-channels.test.js), with a public base URL set.
function addManagedInstance(publicBaseUrl) {
  setSetting(VPN_ENABLED_SETTING, "false");
  const { key } = provisionInstance({ displayName: "Managed" });
  saveComponentValues(
    "instance",
    {
      ...getComponentValues("instance", key),
      containerName: "127.0.0.1",
      port: String(instanceServer.address().port),
      publicBaseUrl,
    },
    key
  );
  return { id: key };
}

test("list shapes shares and returns paths only for a hand-added instance", async () => {
  const instance = addInstance();
  nextResponse = { status: 200, body: { success: true, data: [RAW_SHARE] } };

  const client = await signedInClient(base);
  const res = await client.get(`/api/instances/${instance.id}/shares`);

  assert.equal(res.status, 200);
  assert.equal(res.body.publicBaseUrl, null);
  assert.deepEqual(res.body.shares, [
    {
      token: "tok",
      streamId: "42",
      title: "Eurosport 1",
      createdBy: "discord-user",
      guest: "Bert",
      startsAt: "2026-10-31T20:00:00Z",
      endsAt: "2026-10-31T23:00:00Z",
      revokedAt: null,
      createdAt: "2026-10-30T09:00:00Z",
      state: "active",
      paths: { playlist: "/share/tok.m3u", stream: "/share/tok/live.ts" },
      urls: null,
    },
  ]);
  assert.equal(seen[0].method, "GET");
  assert.equal(seen[0].url, "/api/internal/shares");
  assert.equal(seen[0].apiKey, "k");
});

test("list builds public addresses for a managed instance with a public base URL", async () => {
  const instance = addManagedInstance("https://tv.example.com/");
  nextResponse = { status: 200, body: { success: true, data: [RAW_SHARE] } };

  const client = await signedInClient(base);
  const res = await client.get(`/api/instances/${instance.id}/shares`);

  assert.equal(res.status, 200);
  assert.equal(res.body.publicBaseUrl, "https://tv.example.com");
  assert.equal(res.body.shares[0].urls.stream, "https://tv.example.com/share/tok/live.ts");
  assert.equal(res.body.shares[0].urls.playlist, "https://tv.example.com/share/tok.m3u");
});

test("list turns an instance 404 into 501 shares_unsupported", async () => {
  const instance = addInstance();
  nextResponse = { status: 404, body: { success: false, error: "404 page not found" } };

  const client = await signedInClient(base);
  const res = await client.get(`/api/instances/${instance.id}/shares`);

  assert.equal(res.status, 501);
  assert.equal(res.body.code, "shares_unsupported");
});

test("list reports an instance failure as 502 with its message", async () => {
  const instance = addInstance();
  nextResponse = { status: 503, body: { success: false, error: "share links unavailable" } };

  const client = await signedInClient(base);
  const res = await client.get(`/api/instances/${instance.id}/shares`);

  assert.equal(res.status, 502);
  assert.match(res.body.error, /share links unavailable/);
});

test("create fills username from the actor setting and forwards times", async () => {
  const instance = addInstance();
  nextResponse = { status: 200, body: { success: true, data: RAW_SHARE } };
  const payload = {
    guest: "Bert",
    streamId: "42",
    startsAt: "2026-10-31T20:00:00.000Z",
    endsAt: "2026-10-31T23:00:00.000Z",
  };

  const client = await signedInClient(base);
  const res = await client.post(`/api/instances/${instance.id}/shares`, payload);

  assert.equal(res.status, 200);
  assert.equal(res.body.token, "tok");
  assert.equal(res.body.state, "active");
  assert.equal(seen[0].method, "POST");
  assert.equal(seen[0].url, "/api/internal/shares");
  assert.deepEqual(seen[0].body, {
    username: "suite",
    guest: "Bert",
    stream_id: "42",
    starts_at: "2026-10-31T20:00:00.000Z",
    ends_at: "2026-10-31T23:00:00.000Z",
  });

  setSetting("general.vod_actor_username", "cinema");
  await client.post(`/api/instances/${instance.id}/shares`, payload);
  assert.equal(seen[1].body.username, "cinema");
});

test("create rejects a missing streamId or endsAt with 400 and no instance call", async () => {
  const instance = addInstance();
  const client = await signedInClient(base);

  const noChannel = await client.post(`/api/instances/${instance.id}/shares`, {
    endsAt: "2026-10-31T23:00:00.000Z",
  });
  const noEnd = await client.post(`/api/instances/${instance.id}/shares`, { streamId: "42" });

  assert.equal(noChannel.status, 400);
  assert.equal(noEnd.status, 400);
  assert.equal(seen.length, 0);
});

test("create surfaces an instance validation error verbatim", async () => {
  const instance = addInstance();
  nextResponse = {
    status: 400,
    body: { success: false, error: "a share link may last at most 24h0m0s" },
  };

  const client = await signedInClient(base);
  const res = await client.post(`/api/instances/${instance.id}/shares`, {
    streamId: "42",
    endsAt: "2026-11-02T23:00:00.000Z",
  });

  assert.equal(res.status, 400);
  assert.equal(res.body.error, "a share link may last at most 24h0m0s");
});

test("revoke URL-encodes the token and returns the revoked share", async () => {
  const instance = addInstance();
  nextResponse = {
    status: 200,
    body: { success: true, data: { ...RAW_SHARE, token: "a-b_c", state: "revoked", revoked_at: "2026-10-31T21:00:00Z" } },
  };

  const client = await signedInClient(base);
  const res = await client.del(`/api/instances/${instance.id}/shares/a-b_c`);

  assert.equal(res.status, 200);
  assert.equal(res.body.state, "revoked");
  assert.equal(res.body.revokedAt, "2026-10-31T21:00:00Z");
  assert.equal(seen[0].method, "DELETE");
  assert.equal(seen[0].url, "/api/internal/shares/a-b_c");
});

test("revoke passes an instance 404 through without the unsupported code", async () => {
  const instance = addInstance();
  nextResponse = { status: 404, body: { success: false, error: "unknown share link" } };

  const client = await signedInClient(base);
  const res = await client.del(`/api/instances/${instance.id}/shares/nope`);

  assert.equal(res.status, 404);
  assert.equal(res.body.error, "unknown share link");
  assert.equal(res.body.code, undefined);
});

test("channels maps results and skips the instance for an empty query", async () => {
  const instance = addInstance();
  nextResponse = {
    status: 200,
    body: { success: true, data: [{ stream_id: "412", num: "412", name: "Eurosport 1" }] },
  };

  const client = await signedInClient(base);
  const res = await client.get(`/api/instances/${instance.id}/shares/channels?q=eurosport`);

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.results, [{ streamId: "412", num: "412", name: "Eurosport 1" }]);
  assert.equal(seen[0].url, "/api/internal/shares/channels?q=eurosport");

  const empty = await client.get(`/api/instances/${instance.id}/shares/channels`);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.results, []);
  assert.equal(seen.length, 1, "an empty query must not reach the instance");
});

test("all four routes 404 for an unknown instance", async () => {
  const client = await signedInClient(base);
  const missing = "/api/instances/does-not-exist/shares";

  const responses = [
    await client.get(missing),
    await client.post(missing, { streamId: "42", endsAt: "2026-10-31T23:00:00.000Z" }),
    await client.del(`${missing}/tok`),
    await client.get(`${missing}/channels?q=bbc`),
  ];
  for (const res of responses) {
    assert.equal(res.status, 404);
    assert.equal(res.body.error, "Unknown instance");
  }
});

test("unauthenticated list is 401 and a POST without the CSRF header is 403", async () => {
  const instance = addInstance();

  assert.equal((await apiClient(base).get(`/api/instances/${instance.id}/shares`)).status, 401);

  const client = await signedInClient(base);
  client.dropCsrf();
  const res = await client.post(`/api/instances/${instance.id}/shares`, {
    streamId: "42",
    endsAt: "2026-10-31T23:00:00.000Z",
  });
  assert.equal(res.status, 403);
  assert.equal(seen.length, 0);
});
