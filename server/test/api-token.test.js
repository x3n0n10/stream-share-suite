// The API token: one long-lived bearer token that lets an API client reach an
// explicit allowlist of routes without a session. Unit tests for the token
// store first, then the HTTP boundary end to end.

import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase, signedInClient } from "./helpers.js";
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
