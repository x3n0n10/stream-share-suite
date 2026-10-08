import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { hostname } from "node:os";
import { ipv4NetworkCidr, getSelfNetworks, getSelfContainerName } from "../src/docker/self.js";

test("computes the network address for a /24", () => {
  assert.equal(ipv4NetworkCidr("172.18.0.11", 24), "172.18.0.0/24");
});

test("computes the network address for a /16", () => {
  assert.equal(ipv4NetworkCidr("172.18.5.200", 16), "172.18.0.0/16");
});

test("a /32 is the address itself", () => {
  assert.equal(ipv4NetworkCidr("10.0.0.5", 32), "10.0.0.5/32");
});

test("a /0 is the zero network", () => {
  assert.equal(ipv4NetworkCidr("203.0.113.7", 0), "0.0.0.0/0");
});

test("an address already at the network boundary is unchanged", () => {
  assert.equal(ipv4NetworkCidr("192.168.1.0", 24), "192.168.1.0/24");
});

test("returns null for missing or malformed input rather than throwing", () => {
  assert.equal(ipv4NetworkCidr(null, 24), null);
  assert.equal(ipv4NetworkCidr("172.18.0.11", null), null);
  assert.equal(ipv4NetworkCidr("not-an-ip", 24), null);
  assert.equal(ipv4NetworkCidr("172.18.0.11", 33), null);
  assert.equal(ipv4NetworkCidr("172.18.0.11", -1), null);
  assert.equal(ipv4NetworkCidr("999.1.1.1", 24), null);
});

test("getSelfNetworks returns an empty list when Docker is unreachable, rather than throwing", async () => {
  const original = process.env.DOCKER_PROXY_URL;
  process.env.DOCKER_PROXY_URL = "http://127.0.0.1:1"; // nothing listens here
  try {
    assert.deepEqual(await getSelfNetworks(), []);
  } finally {
    process.env.DOCKER_PROXY_URL = original;
  }
});

async function withFakeDocker(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, resolve));
  const original = process.env.DOCKER_PROXY_URL;
  process.env.DOCKER_PROXY_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    await run();
  } finally {
    if (original === undefined) delete process.env.DOCKER_PROXY_URL;
    else process.env.DOCKER_PROXY_URL = original;
    server.close();
  }
}

test("getSelfContainerName returns the inspected name without its leading slash", async () => {
  await withFakeDocker(
    (req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === `/v1.43/containers/${hostname()}/json`) return res.end(JSON.stringify({ Name: "/my-suite" }));
      res.statusCode = 404;
      res.end(JSON.stringify({ message: "No such container" }));
    },
    async () => {
      assert.equal(await getSelfContainerName(), "my-suite");
    }
  );
});

test("getSelfContainerName falls back to stream-share-suite when the container is not found", async () => {
  await withFakeDocker(
    (req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.statusCode = 404;
      res.end(JSON.stringify({ message: "No such container" }));
    },
    async () => {
      assert.equal(await getSelfContainerName(), "stream-share-suite");
    }
  );
});

test("getSelfContainerName falls back to stream-share-suite when Docker is unreachable, rather than throwing", async () => {
  const original = process.env.DOCKER_PROXY_URL;
  process.env.DOCKER_PROXY_URL = "http://127.0.0.1:1"; // nothing listens here
  try {
    assert.equal(await getSelfContainerName(), "stream-share-suite");
  } finally {
    if (original === undefined) delete process.env.DOCKER_PROXY_URL;
    else process.env.DOCKER_PROXY_URL = original;
  }
});
