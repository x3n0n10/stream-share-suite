// Failover wiring: which instances an instance falls back to, and the key it
// accepts when lending a connection. Both are derived from stored values, so
// nothing new is stored and an instance outside every fallback list gets no
// new environment (its container is not recreated).

import { createHash } from "node:crypto";
import { instanceContainerName } from "./instance.js";
import { isVpnEnabled } from "./catalog.js";

export function failoverKey(apiKey) {
  return createHash("sha256").update(`failover:${apiKey}`).digest("hex");
}

// Instances reach each other directly, not via the dashboard's address: with
// the VPN on they all share gluetun's network namespace, so loopback.
export function peerUrl(key, values) {
  const host = isVpnEnabled() ? "127.0.0.1" : instanceContainerName(key, values);
  return `http://${host}:${Number(values.port)}`;
}

const keysOf = (values) => String(values.fallbacks || "").split(",").map((k) => k.trim()).filter(Boolean);

export function failoverEnv(key, values, instances) {
  const byKey = new Map(instances.map((row) => [row.key, JSON.parse(row.config_json)]));
  const peers = [];
  for (const k of new Set(keysOf(values))) {
    const peer = byKey.get(k);
    if (k === key || !peer?._apiKey || !(Number(peer.port) > 0)) continue;
    peers.push({ name: peer.displayName || k, url: peerUrl(k, peer), key: failoverKey(peer._apiKey) });
  }

  const env = {};
  if (peers.length) env.FAILOVER_INSTANCES = JSON.stringify(peers);
  if (values._apiKey && [...byKey].some(([k, v]) => k !== key && keysOf(v).includes(key))) {
    env.FAILOVER_KEY = failoverKey(values._apiKey);
  }
  return env;
}
