import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSpecHash, toCreatePayload } from "../src/docker/spec.js";

const BASE = {
  name: "stream-share-gluetun",
  image: "qmcgaw/gluetun:latest",
  env: { VPN_SERVICE_PROVIDER: "nordvpn", VPN_TYPE: "wireguard" },
  labels: { "streamshare.suite.component": "gluetun" },
  capAdd: ["NET_ADMIN"],
  devices: ["/dev/net/tun:/dev/net/tun"],
  networks: ["ssbackend", "nordvpn"],
};

test("the hash is stable across repeated calls on an identical spec", () => {
  assert.equal(computeSpecHash(BASE), computeSpecHash(structuredClone(BASE)));
});

test("key order in env and labels does not affect the hash", () => {
  const reordered = {
    ...BASE,
    env: { VPN_TYPE: "wireguard", VPN_SERVICE_PROVIDER: "nordvpn" },
  };
  assert.equal(computeSpecHash(BASE), computeSpecHash(reordered));
});

test("network and device list order does not affect the hash", () => {
  const reordered = {
    ...BASE,
    networks: ["nordvpn", "ssbackend"],
    devices: ["/dev/net/tun:/dev/net/tun"],
  };
  assert.equal(computeSpecHash(BASE), computeSpecHash(reordered));
});

test("a changed env value changes the hash", () => {
  const changed = { ...BASE, env: { ...BASE.env, VPN_SERVICE_PROVIDER: "mullvad" } };
  assert.notEqual(computeSpecHash(BASE), computeSpecHash(changed));
});

test("a changed image tag changes the hash", () => {
  const changed = { ...BASE, image: "qmcgaw/gluetun:v3.40.0" };
  assert.notEqual(computeSpecHash(BASE), computeSpecHash(changed));
});

test("an added network changes the hash", () => {
  const changed = { ...BASE, networks: [...BASE.networks, "extra"] };
  assert.notEqual(computeSpecHash(BASE), computeSpecHash(changed));
});

test("an empty-vs-missing optional field does not produce different hashes for equivalent specs", () => {
  const minimal = { name: "x", image: "y" };
  const explicit = { name: "x", image: "y", env: {}, labels: {}, capAdd: [], devices: [], networks: [] };
  assert.equal(computeSpecHash(minimal), computeSpecHash(explicit));
});

test("toCreatePayload converts the env object to Docker's KEY=value array form", () => {
  const payload = toCreatePayload(BASE, { labels: BASE.labels });
  assert.deepEqual(
    payload.Env.sort(),
    ["VPN_SERVICE_PROVIDER=nordvpn", "VPN_TYPE=wireguard"].sort()
  );
});

test("toCreatePayload puts CapAdd and Devices under HostConfig, not the top level", () => {
  const payload = toCreatePayload(BASE);
  assert.deepEqual(payload.HostConfig.CapAdd, ["NET_ADMIN"]);
  assert.deepEqual(payload.HostConfig.Devices, [
    { PathOnHost: "/dev/net/tun", PathOnContainer: "/dev/net/tun", CgroupPermissions: "rwm" },
  ]);
});

test("toCreatePayload uses the first network as NetworkMode and lists it in EndpointsConfig", () => {
  const payload = toCreatePayload(BASE);
  assert.equal(payload.HostConfig.NetworkMode, "ssbackend");
  assert.deepEqual(Object.keys(payload.NetworkingConfig.EndpointsConfig), ["ssbackend"]);
});

test("toCreatePayload falls back to the bridge network when none is specified", () => {
  const payload = toCreatePayload({ image: "x" });
  assert.equal(payload.HostConfig.NetworkMode, "bridge");
  assert.equal(payload.NetworkingConfig, undefined);
});

test("toCreatePayload prefers the labels argument over spec.labels", () => {
  const payload = toCreatePayload(BASE, { labels: { override: "yes" } });
  assert.deepEqual(payload.Labels, { override: "yes" });
});

test("a device entry without an explicit container path mirrors the host path", () => {
  const payload = toCreatePayload({ image: "x", devices: ["/dev/net/tun"] });
  assert.equal(payload.HostConfig.Devices[0].PathOnContainer, "/dev/net/tun");
});
