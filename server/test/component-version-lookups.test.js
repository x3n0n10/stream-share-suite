// The three ways a component reports its own version: a stream-share
// instance's /api/internal/version, gluetun's /v1/version, and PostgreSQL's
// server_version string. Each is a thin call plus a little parsing.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fetchVersion, InstanceError } from "../src/instanceClient.js";
import { getVersion, gluetunVersionFrom } from "../src/gluetunClient.js";
import { parseServerVersion } from "../src/reconcile/database.js";

let server;
let next;
let seen;

before(async () => {
  server = createServer((req, res) => {
    seen = { url: req.url, headers: req.headers };
    res.writeHead(next.status, { "Content-Type": "application/json" });
    res.end(typeof next.body === "string" ? next.body : JSON.stringify(next.body));
  });
  await new Promise((resolve) => server.listen(0, resolve));
});

after(() => server.close());

const base = () => `http://127.0.0.1:${server.address().port}`;

test("fetchVersion returns the trimmed version and sends the API key to the right path", async () => {
  next = { status: 200, body: { success: true, data: { version: " 1.4.2 " } } };
  const version = await fetchVersion({ url: base(), apiKey: "secret" }, { timeoutMs: 2000 });
  assert.equal(version, "1.4.2");
  assert.equal(seen.url, "/api/internal/version");
  assert.equal(seen.headers["x-api-key"], "secret");
});

test("fetchVersion throws an InstanceError carrying the status on a 404", async () => {
  next = { status: 404, body: { error: "not found" } };
  await assert.rejects(
    () => fetchVersion({ url: base(), apiKey: "k" }, { timeoutMs: 2000 }),
    (err) => err instanceof InstanceError && err.status === 404
  );
});

test("fetchVersion throws when the response carries no usable version", async () => {
  next = { status: 200, body: { success: true, data: { version: "   " } } };
  await assert.rejects(() => fetchVersion({ url: base(), apiKey: "k" }, { timeoutMs: 2000 }), InstanceError);

  next = { status: 200, body: { success: true, data: {} } };
  await assert.rejects(() => fetchVersion({ url: base(), apiKey: "k" }, { timeoutMs: 2000 }), InstanceError);

  next = { status: 200, body: { success: true } };
  await assert.rejects(() => fetchVersion({ url: base(), apiKey: "k" }, { timeoutMs: 2000 }), InstanceError);
});

test("fetchVersion throws on a non-JSON body", async () => {
  next = { status: 200, body: "not json" };
  await assert.rejects(() => fetchVersion({ url: base(), apiKey: "k" }, { timeoutMs: 2000 }), InstanceError);
});

test("gluetun getVersion asks /v1/version with the API key and returns the version", async () => {
  next = { status: 200, body: { version: "v3.40.0", commit: "abcdef1234", created: "2025-01-01" } };
  const gluetun = { url: base(), apiKey: "gk", timeoutMs: 2000 };
  assert.equal(await getVersion(gluetun), "v3.40.0");
  assert.equal(seen.url, "/v1/version");
  assert.equal(seen.headers["x-api-key"], "gk");
});

test("gluetunVersionFrom passes a real version through", () => {
  assert.equal(gluetunVersionFrom({ version: "v3.40.0", commit: "abcdef1234" }), "v3.40.0");
});

test("gluetunVersionFrom uses the short commit when the version is a placeholder", () => {
  assert.equal(gluetunVersionFrom({ version: "latest", commit: "abcdef1234567" }), "abcdef1");
  assert.equal(gluetunVersionFrom({ version: "unknown", commit: "9999999aaaa" }), "9999999");
  assert.equal(gluetunVersionFrom({ version: "", commit: "1234567890" }), "1234567");
});

test("gluetunVersionFrom returns null when neither version nor commit is usable", () => {
  assert.equal(gluetunVersionFrom({ version: "unknown", commit: "unknown" }), null);
  assert.equal(gluetunVersionFrom({}), null);
  assert.equal(gluetunVersionFrom(null), null);
});

test("parseServerVersion keeps the leading numeric version and drops the build suffix", () => {
  assert.equal(parseServerVersion("16.4 (Debian 16.4-1.pgdg120+1)"), "16.4");
  assert.equal(parseServerVersion("14.13"), "14.13");
  assert.equal(parseServerVersion("  15.2.1 "), "15.2.1");
});

test("parseServerVersion returns null for anything that does not start with a version", () => {
  assert.equal(parseServerVersion(""), null);
  assert.equal(parseServerVersion(undefined), null);
  assert.equal(parseServerVersion("garbage"), null);
});
