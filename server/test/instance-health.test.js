// fetchHealth's one deliberate difference from every other instanceClient
// call: stream-share answers HTTP 503 (not 200) exactly when the provider is
// blocked or erroring, and the verdict is in the body either way — this must
// never be swallowed as a generic transport failure.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fetchHealth } from "../src/instanceClient.js";

let server;
let nextResponse;

before(async () => {
  server = createServer((req, res) => {
    res.writeHead(nextResponse.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(nextResponse.body));
  });
  await new Promise((resolve) => server.listen(0, resolve));
});

after(() => server.close());

function instance() {
  return { url: `http://127.0.0.1:${server.address().port}`, apiKey: "k" };
}

test("reads the body on a 200 healthy verdict", async () => {
  nextResponse = { status: 200, body: { status: "healthy", detail: null } };
  assert.deepEqual(await fetchHealth(instance(), { timeoutMs: 2000 }), {
    status: "healthy",
    detail: null,
  });
});

test("reads the body on a 503 blocked verdict rather than throwing", async () => {
  nextResponse = { status: 503, body: { status: "blocked", detail: "upstream returned 456" } };
  assert.deepEqual(await fetchHealth(instance(), { timeoutMs: 2000 }), {
    status: "blocked",
    detail: "upstream returned 456",
  });
});

test("throws for any other HTTP status", async () => {
  nextResponse = { status: 401, body: { error: "unauthorized" } };
  await assert.rejects(() => fetchHealth(instance(), { timeoutMs: 2000 }), /unauthorized/);
});

test("throws on a non-JSON response", async () => {
  server.close();
  server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("not json");
  });
  await new Promise((resolve) => server.listen(0, resolve));
  await assert.rejects(() => fetchHealth(instance(), { timeoutMs: 2000 }), /Non-JSON/);
});
