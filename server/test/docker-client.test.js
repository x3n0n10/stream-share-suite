// Exercises the Docker client against a real HTTP server standing in for the
// socket proxy, so the request shapes (query params, filter encoding, status
// code handling) are proven against actual wire traffic rather than mocked
// away. The endpoint shapes it asserts on come from the Docker Engine API
// v1.43 OpenAPI spec.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

let server;
let requests;

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      requests.push({ method: req.method, path: url.pathname, query: url.searchParams, body });
      const handler = server._handlers.shift();
      if (!handler) {
        res.writeHead(500).end(JSON.stringify({ message: "no handler queued" }));
        return;
      }
      handler(res);
    });
  });
  server._handlers = [];
  await new Promise((resolve) => server.listen(0, resolve));
  process.env.DOCKER_PROXY_URL = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

beforeEach(() => {
  requests = [];
  server._handlers = [];
});

function queue(fn) {
  server._handlers.push(fn);
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const client = () => import("../src/docker/client.js");

test("listContainers encodes filters as a JSON map[string][]string and defaults all=true", async () => {
  const { listContainers } = await client();
  queue((res) => json(res, 200, []));

  await listContainers({ filters: { label: ["streamshare.suite.managed=true"] } });

  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].path, "/v1.43/containers/json");
  assert.equal(requests[0].query.get("all"), "true");
  assert.deepEqual(JSON.parse(requests[0].query.get("filters")), {
    label: ["streamshare.suite.managed=true"],
  });
});

test("inspectContainer returns null on 404 rather than throwing", async () => {
  const { inspectContainer } = await client();
  queue((res) => json(res, 404, { message: "No such container: x" }));

  assert.equal(await inspectContainer("nonexistent"), null);
});

test("inspectContainer returns the parsed body on 200", async () => {
  const { inspectContainer } = await client();
  queue((res) => json(res, 200, { Id: "abc123", State: { Status: "running" } }));

  const result = await inspectContainer("abc123");
  assert.equal(result.Id, "abc123");
  assert.equal(result.State.Status, "running");
});

test("createContainer passes the name as a query parameter, not in the body", async () => {
  const { createContainer } = await client();
  queue((res) => json(res, 201, { Id: "newid", Warnings: [] }));

  const result = await createContainer("stream-share-gluetun", { Image: "qmcgaw/gluetun" });

  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].query.get("name"), "stream-share-gluetun");
  assert.equal(JSON.parse(requests[0].body).Image, "qmcgaw/gluetun");
  assert.equal(result.Id, "newid");
});

test("createContainer surfaces a 404 (no such image) as a DockerError", async () => {
  const { createContainer, DockerError } = await client();
  queue((res) => json(res, 404, { message: "No such image: bogus" }));

  await assert.rejects(() => createContainer("x", { Image: "bogus" }), (err) => {
    assert.ok(err instanceof DockerError);
    assert.match(err.message, /No such image/);
    return true;
  });
});

test("createContainer surfaces a 409 conflict (name already in use)", async () => {
  const { createContainer, DockerError } = await client();
  queue((res) => json(res, 409, { message: "Conflict. The container name is already in use" }));

  await assert.rejects(() => createContainer("taken", {}), DockerError);
});

test("startContainer treats 204 and 304 as success", async () => {
  const { startContainer } = await client();
  queue((res) => res.writeHead(204).end());
  await startContainer("abc");

  queue((res) => res.writeHead(304).end());
  await startContainer("abc");
});

test("startContainer throws on 404", async () => {
  const { startContainer, DockerError } = await client();
  queue((res) => json(res, 404, { message: "No such container" }));
  await assert.rejects(() => startContainer("gone"), DockerError);
});

test("stopContainer sends the timeout as query param `t` and accepts 204/304", async () => {
  const { stopContainer } = await client();
  queue((res) => res.writeHead(204).end());
  await stopContainer("abc", { timeoutSeconds: 20 });
  assert.equal(requests[0].query.get("t"), "20");

  queue((res) => res.writeHead(304).end());
  await stopContainer("abc");
});

test("removeContainer treats 404 as success (already gone)", async () => {
  const { removeContainer } = await client();
  queue((res) => res.writeHead(404).end());
  await removeContainer("already-gone");
});

test("removeContainer sends force and v as query params", async () => {
  const { removeContainer } = await client();
  queue((res) => res.writeHead(204).end());
  await removeContainer("abc", { force: true });

  assert.equal(requests[0].query.get("force"), "true");
  assert.equal(requests[0].query.get("v"), "true");
});

test("removeContainer surfaces a 409 (still running) rather than swallowing it", async () => {
  const { removeContainer, DockerError } = await client();
  queue((res) => json(res, 409, { message: "You cannot remove a running container" }));
  await assert.rejects(() => removeContainer("running", { force: false }), DockerError);
});

test("an unreachable proxy is reported as a DockerError, not a raw fetch failure", async () => {
  const original = process.env.DOCKER_PROXY_URL;
  process.env.DOCKER_PROXY_URL = "http://127.0.0.1:1"; // nothing listens on port 1
  try {
    const { listContainers, DockerError } = await client();
    await assert.rejects(() => listContainers(), (err) => {
      assert.ok(err instanceof DockerError);
      assert.match(err.message, /Cannot reach the Docker socket proxy/);
      return true;
    });
  } finally {
    process.env.DOCKER_PROXY_URL = original;
  }
});
