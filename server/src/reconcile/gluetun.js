// Renders the gluetun component's stored field values into a normalized
// container spec (see docker/spec.js) — the thing the reconciler actually
// diffs and, when it decides to, creates.

import { GLUETUN_SCHEMA } from "../schema/gluetun.js";
import { renderEnv } from "../schema/registry.js";
import { getSelfNetworks } from "../docker/self.js";

export const GLUETUN_CONTAINER_NAME = "stream-share-gluetun";

const IMAGE_FIELD = GLUETUN_SCHEMA.fields.find((f) => f.key === "image");

// The extraEnv escape hatch (see schema/gluetun.js) fills gaps for providers
// with no modeled fields — it never overrides one that exists, so a typo in
// a named field is still a save-time validation error rather than being
// silently shadowed by a stray line here. Malformed lines (no "=", blank,
// "#" comments) are dropped rather than rejected: the whole point is to
// never block an apply on this field.
function parseExtraEnv(raw) {
  const env = {};
  for (const line of String(raw || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}

export async function renderGluetunSpec(values) {
  const env = { ...parseExtraEnv(values.extraEnv), ...renderEnv(GLUETUN_SCHEMA, values) };

  // Fixed, not a schema field: this is where the rest of the Suite (and, in a
  // later phase, the VPN healer) expects to find the control server, and
  // there is no reason it would ever need to be anything else.
  env.HTTP_CONTROL_SERVER_ADDRESS = ":8000";

  // Computed rather than asked of the operator: gluetun must accept inbound
  // from whatever subnet the Suite itself is on, or it blocks the Suite's own
  // reach to gluetun's control API and, once instances exist, their traffic
  // to PostgreSQL. See the blueprint's invariants table. Left unset (gluetun
  // then applies its own default firewall) if it can't be determined —
  // never guessed.
  const selfNetworks = await getSelfNetworks();
  const subnets = selfNetworks.map((n) => n.subnet).filter(Boolean);
  if (subnets.length > 0) env.FIREWALL_OUTBOUND_SUBNETS = subnets.join(",");

  const networks = String(values.networks || "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);

  return {
    name: GLUETUN_CONTAINER_NAME,
    image: values.image || IMAGE_FIELD.default,
    env,
    capAdd: ["NET_ADMIN"],
    devices: ["/dev/net/tun:/dev/net/tun"],
    networks,
    restartPolicy: "unless-stopped",
  };
}
