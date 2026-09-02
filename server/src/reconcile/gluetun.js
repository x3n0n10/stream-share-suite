// Renders the gluetun component's stored field values into a normalized
// container spec (see docker/spec.js) — the thing the reconciler actually
// diffs and, when it decides to, creates.

import { GLUETUN_SCHEMA } from "../schema/gluetun.js";
import { renderEnv } from "../schema/registry.js";
import { getSelfNetworks } from "../docker/self.js";
import { listComponents, getComponentValues } from "../store/components.js";
import { parseExtraEnv } from "./env.js";
import { containerPrefix } from "./prefix.js";
import { isUhfEnabled } from "./catalog.js";

// Kept as a literal rather than imported from reconcile/uhf.js's own default,
// so that this file — like the rest of it — reads the store directly instead
// of pulling in a sibling component's render module just for one number.
const UHF_PORT_DEFAULT = 8000;

// Overridable per the containerName field, the same way instances are —
// critically, this is how a gluetun container the operator already runs
// under a different name stays adopted after this default changes.
export function gluetunContainerName(values = {}) {
  return String(values.containerName || "").trim() || `${containerPrefix()}gluetun`;
}

const IMAGE_FIELD = GLUETUN_SCHEMA.fields.find((f) => f.key === "image");
const NETWORKS_FIELD = GLUETUN_SCHEMA.fields.find((f) => f.key === "networks");

// Every port gluetun publishes on behalf of something sharing its network
// namespace — every instance, plus UHF when it's switched on.
//
// This is the one place the dependency runs backwards: a container inside
// gluetun's network namespace cannot bind a host port itself, so gluetun has
// to do it. The consequence is worth stating plainly — adding an instance (or
// switching UHF on) changes gluetun's spec, which recreates gluetun, which
// cascades to everything else sharing its namespace. That is the same thing
// `docker compose up` does to this topology, and it is why the plan shows the
// cascade.
function publishedPorts() {
  const ports = listComponents("instance")
    .map((row) => Number(JSON.parse(row.config_json).port))
    .filter((port) => Number.isFinite(port) && port > 0);

  if (isUhfEnabled()) {
    const uhfPort = Number(getComponentValues("uhf").port || UHF_PORT_DEFAULT);
    if (Number.isFinite(uhfPort) && uhfPort > 0) ports.push(uhfPort);
  }

  return [...new Set(ports)]
    .sort((a, b) => a - b)
    .map((port) => ({ host: port, container: port, protocol: "tcp" }));
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

  const networks = String(values.networks || NETWORKS_FIELD.default)
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);

  const spec = {
    name: gluetunContainerName(values),
    image: values.image || IMAGE_FIELD.default,
    env,
    capAdd: ["NET_ADMIN"],
    devices: ["/dev/net/tun:/dev/net/tun"],
    networks,
    restartPolicy: "unless-stopped",
  };

  const ports = publishedPorts();
  if (ports.length > 0) spec.ports = ports;

  return spec;
}
