// searchChannels is a thin GET wrapper — this proves the query lands in the
// URL correctly and that the instance's envelope (success/data or
// success:false/error) is unwrapped the same way every other instanceClient
// call handles it.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { searchChannels } from "../src/instanceClient.js";

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

test("returns the matches from a successful search", async () => {
  nextResponse = {
    status: 200,
    body: { success: true, data: [{ StreamID: "42", Name: "BBC One", Category: "UK" }] },
  };
  assert.deepEqual(await searchChannels(instance(), "bbc", { timeoutMs: 2000 }), [
    { StreamID: "42", Name: "BBC One", Category: "UK" },
  ]);
});

test("sends the query as ?q=", async () => {
  let seenUrl;
  const savedServer = server;
  server.close();
  server = createServer((req, res) => {
    seenUrl = req.url;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, data: [] }));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  await searchChannels(instance(), "bbc one", { timeoutMs: 2000 });
  assert.equal(seenUrl, "/api/internal/channels?q=bbc+one");
  // Restore the original server for remaining tests
  server.close();
  server = createServer((req, res) => {
    res.writeHead(nextResponse.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(nextResponse.body));
  });
  await new Promise((resolve) => server.listen(0, resolve));
});

test("throws on an error response", async () => {
  nextResponse = { status: 502, body: { success: false, error: "provider unreachable" } };
  await assert.rejects(
    () => searchChannels(instance(), "bbc", { timeoutMs: 2000 }),
    /provider unreachable/
  );
});
