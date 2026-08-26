import { test } from "node:test";
import assert from "node:assert/strict";
import { ipv4NetworkCidr, getSelfNetworks } from "../src/docker/self.js";

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
