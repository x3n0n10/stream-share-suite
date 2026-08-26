// Exercises the real gluetun schema through renderGluetunSpec, including the
// self-network lookup — via a fake Docker proxy, the same technique as
// docker-client.test.js — rather than mocking it away, since "does the
// computed FIREWALL_OUTBOUND_SUBNETS actually reach the env" is exactly the
// kind of wiring that's easy to get right in isolation and wrong end to end.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { renderGluetunSpec, GLUETUN_CONTAINER_NAME } from "../src/reconcile/gluetun.js";

let server;
let nextInspectResponse;

before(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(nextInspectResponse));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  process.env.DOCKER_PROXY_URL = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

beforeEach(() => {
  nextInspectResponse = {
    Id: "selfid",
    NetworkSettings: { Networks: { ssbackend: { IPAddress: "172.18.0.20", IPPrefixLen: 24 } } },
  };
});

const WIREGUARD_VALUES = {
  networks: "ssbackend, nordvpn",
  vpnServiceProvider: "nordvpn",
  vpnType: "wireguard",
  wireguardPrivateKey: "secret-key",
};

test("computes FIREWALL_OUTBOUND_SUBNETS from the Suite's own network", async () => {
  const spec = await renderGluetunSpec(WIREGUARD_VALUES);
  assert.equal(spec.env.FIREWALL_OUTBOUND_SUBNETS, "172.18.0.0/24");
});

test("joins multiple self-networks' subnets when the Suite is on more than one", async () => {
  nextInspectResponse.NetworkSettings.Networks.extra = { IPAddress: "10.0.0.5", IPPrefixLen: 16 };
  const spec = await renderGluetunSpec(WIREGUARD_VALUES);
  assert.equal(spec.env.FIREWALL_OUTBOUND_SUBNETS, "172.18.0.0/24,10.0.0.0/16");
});

test("leaves FIREWALL_OUTBOUND_SUBNETS unset when self-inspection fails, rather than guessing", async () => {
  const original = process.env.DOCKER_PROXY_URL;
  process.env.DOCKER_PROXY_URL = "http://127.0.0.1:1";
  try {
    const spec = await renderGluetunSpec(WIREGUARD_VALUES);
    assert.equal("FIREWALL_OUTBOUND_SUBNETS" in spec.env, false);
  } finally {
    process.env.DOCKER_PROXY_URL = original;
  }
});

test("HTTP_CONTROL_SERVER_ADDRESS is fixed regardless of input", async () => {
  const spec = await renderGluetunSpec(WIREGUARD_VALUES);
  assert.equal(spec.env.HTTP_CONTROL_SERVER_ADDRESS, ":8000");
});

test("the networks field is parsed from a comma-separated string, trimmed", async () => {
  const spec = await renderGluetunSpec(WIREGUARD_VALUES);
  assert.deepEqual(spec.networks, ["ssbackend", "nordvpn"]);
});

test("the image falls back to the schema default when unset", async () => {
  const spec = await renderGluetunSpec(WIREGUARD_VALUES);
  assert.equal(spec.image, "qmcgaw/gluetun:latest");
});

test("an explicit image overrides the default", async () => {
  const spec = await renderGluetunSpec({ ...WIREGUARD_VALUES, image: "qmcgaw/gluetun:v3.40" });
  assert.equal(spec.image, "qmcgaw/gluetun:v3.40");
});

test("OpenVPN fields are rendered and WireGuard fields are omitted when vpnType is openvpn", async () => {
  const spec = await renderGluetunSpec({
    networks: "ssbackend",
    vpnServiceProvider: "nordvpn",
    vpnType: "openvpn",
    openvpnUser: "user1",
    openvpnPassword: "pass1",
  });
  assert.equal(spec.env.OPENVPN_USER, "user1");
  assert.equal(spec.env.OPENVPN_PASSWORD, "pass1");
  assert.equal("WIREGUARD_PRIVATE_KEY" in spec.env, false);
});

test("the container name is fixed and matches the user's own compose convention", async () => {
  const spec = await renderGluetunSpec(WIREGUARD_VALUES);
  assert.equal(spec.name, GLUETUN_CONTAINER_NAME);
  assert.equal(spec.name, "stream-share-gluetun");
});

test("always carries NET_ADMIN and the tun device, unconditionally", async () => {
  const spec = await renderGluetunSpec(WIREGUARD_VALUES);
  assert.deepEqual(spec.capAdd, ["NET_ADMIN"]);
  assert.deepEqual(spec.devices, ["/dev/net/tun:/dev/net/tun"]);
});
