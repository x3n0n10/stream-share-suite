// The API token: one long-lived bearer token that lets an API client reach an
// explicit allowlist of routes without a session. Unit tests for the token
// store first, then the HTTP boundary end to end.

import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase, signedInClient, TEST_PASSWORD } from "./helpers.js";
import { createApp } from "../src/app.js";
import { _resetLoginThrottle } from "../src/auth/middleware.js";
import {
  apiTokenStatus,
  generateApiToken,
  revokeApiToken,
  verifyApiToken,
} from "../src/auth/apiToken.js";

let server;
let base;
let db;

before(async () => {
  server = createApp({ serveStatic: false }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

beforeEach(() => {
  db = freshDatabase();
  _resetLoginThrottle();
});

// A bare API client: no cookie, no CSRF header, only the bearer token.
async function bearer(method, path, token) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

test("no token exists on a fresh install", () => {
  assert.deepEqual(apiTokenStatus(), { exists: false, createdAt: null });
  assert.equal(verifyApiToken("anything"), false);
  assert.equal(verifyApiToken(null), false);
});

test("a generated token verifies, and only its hash is stored", () => {
  const { token, createdAt } = generateApiToken();
  assert.equal(verifyApiToken(token), true);
  assert.equal(verifyApiToken(`${token}x`), false);
  assert.deepEqual(apiTokenStatus(), { exists: true, createdAt });

  const stored = db.prepare("SELECT value FROM settings WHERE key = 'api.token_hash'").get().value;
  assert.notEqual(stored, token);
  assert.match(stored, /^[0-9a-f]{64}$/);
});

test("generating again invalidates the previous token", () => {
  const first = generateApiToken().token;
  const second = generateApiToken().token;
  assert.notEqual(first, second);
  assert.equal(verifyApiToken(first), false);
  assert.equal(verifyApiToken(second), true);
});

test("revoking removes the token", () => {
  const { token } = generateApiToken();
  revokeApiToken();
  assert.equal(verifyApiToken(token), false);
  assert.deepEqual(apiTokenStatus(), { exists: false, createdAt: null });
});

test("a valid token reaches the VPN status and reconnect routes without CSRF", async () => {
  const { token } = generateApiToken();

  const status = await bearer("GET", "/api/gluetun", token);
  assert.equal(status.status, 200);
  assert.deepEqual(status.body, { enabled: false });

  // 404 is the handler's own "gluetun not configured" answer, so auth passed.
  const reconnect = await bearer("POST", "/api/gluetun/reconnect", token);
  assert.equal(reconnect.status, 404);
  assert.match(reconnect.body.error, /not configured/);
});

test("a wrong, missing or unconfigured token is refused with 401", async () => {
  assert.equal((await bearer("GET", "/api/gluetun", "no-token-configured")).status, 401);

  generateApiToken();
  assert.equal((await bearer("GET", "/api/gluetun", "wrong")).status, 401);

  const res = await fetch(`${base}/api/gluetun`, { headers: { Authorization: "Bearer" } });
  assert.equal(res.status, 401);
});

test("a valid token is refused with 403 outside the allowlist", async () => {
  const { token } = generateApiToken();
  for (const [method, path] of [
    ["GET", "/api/config"],
    ["GET", "/api/settings"],
    ["POST", "/api/gluetun/stop"],
    ["GET", "/api/settings/api-token"],
    ["POST", "/api/settings/api-token"],
  ]) {
    assert.equal((await bearer(method, path, token)).status, 403, `${method} ${path}`);
  }
});

test("a regenerated or revoked token stops working over HTTP", async () => {
  const old = generateApiToken().token;
  const current = generateApiToken().token;
  assert.equal((await bearer("GET", "/api/gluetun", old)).status, 401);
  assert.equal((await bearer("GET", "/api/gluetun", current)).status, 200);

  revokeApiToken();
  assert.equal((await bearer("GET", "/api/gluetun", current)).status, 401);
});

test("repeated bad tokens hit the login throttle", async () => {
  generateApiToken();
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await bearer("GET", "/api/gluetun", "wrong")).status, 401);
  }
  const res = await fetch(`${base}/api/gluetun`, { headers: { Authorization: "Bearer wrong" } });
  assert.equal(res.status, 429);
  assert.ok(res.headers.get("retry-after"));
});

test("the cookie path still enforces CSRF", async () => {
  const c = await signedInClient(base);
  c.dropCsrf();
  const { status, body } = await c.post("/api/gluetun/reconnect");
  assert.equal(status, 403);
  assert.match(body.error, /CSRF/);
});

test("a signed-in admin generates, reads and revokes the token over HTTP", async () => {
  const c = await signedInClient(base);

  assert.deepEqual((await c.get("/api/settings/api-token")).body, { exists: false, createdAt: null });

  const created = await c.post("/api/settings/api-token");
  assert.equal(created.status, 200);
  assert.equal(typeof created.body.token, "string");
  assert.equal((await bearer("GET", "/api/gluetun", created.body.token)).status, 200);

  const status = (await c.get("/api/settings/api-token")).body;
  assert.deepEqual(status, { exists: true, createdAt: created.body.createdAt });
  assert.equal(status.token, undefined);

  const revoked = await c.del("/api/settings/api-token");
  assert.deepEqual(revoked.body, { exists: false, createdAt: null });
  assert.equal((await bearer("GET", "/api/gluetun", created.body.token)).status, 401);
});

test("token management needs a session", async () => {
  assert.equal((await bearer("POST", "/api/settings/api-token")).status, 401);
});

test("a bearer request never falls back to the cookie session", async () => {
  const setup = await fetch(`${base}/api/auth/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: TEST_PASSWORD }),
  });
  assert.equal(setup.status, 200);
  const cookie = setup.headers.get("set-cookie").split(";")[0];
  const { token } = generateApiToken();

  // The cookie alone is a valid session.
  const session = await fetch(`${base}/api/config`, { headers: { Cookie: cookie } });
  assert.equal(session.status, 200);

  // A wrong bearer is refused even though the cookie is valid.
  const wrong = await fetch(`${base}/api/gluetun`, {
    headers: { Cookie: cookie, Authorization: "Bearer wrong" },
  });
  assert.equal(wrong.status, 401);

  // A valid bearer is confined to the allowlist; the cookie does not widen it.
  const valid = await fetch(`${base}/api/config`, {
    headers: { Cookie: cookie, Authorization: `Bearer ${token}` },
  });
  assert.equal(valid.status, 403);
});

test("changing the password revokes the API token", async () => {
  const c = await signedInClient(base);
  const { token } = (await c.post("/api/settings/api-token")).body;

  const changed = await c.post("/api/auth/password", {
    currentPassword: TEST_PASSWORD,
    newPassword: "another-sufficiently-long-password",
  });
  assert.equal(changed.status, 200);
  assert.equal((await bearer("GET", "/api/gluetun", token)).status, 401);
  assert.deepEqual((await c.get("/api/settings/api-token")).body, { exists: false, createdAt: null });
});
