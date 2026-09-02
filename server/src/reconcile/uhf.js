// Renders the UHF server component to a container spec. See schema/uhf.js
// for what it is and why it follows the stack's VPN choice rather than one
// of its own.

import { UHF_SCHEMA } from "../schema/uhf.js";
import { POSTGRES_SCHEMA } from "../schema/postgres.js";
import { renderEnv } from "../schema/registry.js";
import { getComponentValues } from "../store/components.js";
import { componentCacheDir, ensureDirectory } from "../store/paths.js";
import { isVpnEnabled } from "./catalog.js";
import { gluetunContainerName } from "./gluetun.js";
import { parseExtraEnv } from "./env.js";
import { containerPrefix } from "./prefix.js";

// Where the image keeps recordings. Fixed rather than configurable: it's the
// image's own path, not a preference — see reconcile/instance.js for the
// same reasoning about stream-share's mount points.
const RECORDINGS_MOUNT = "/recordings";

export const UHF_PORT_DEFAULT = 8000;

const POSTGRES_NETWORKS_FIELD = POSTGRES_SCHEMA.fields.find((f) => f.key === "networks");

// Overridable per the containerName field, the same way every other
// component's is — this is how a UHF container the operator already runs
// under a different name stays adopted after this default changes.
export function uhfContainerName(values = {}) {
  return String(values.containerName || "").trim() || `${containerPrefix()}uhf`;
}

export function uhfPort(values = {}) {
  return Number(values.port || UHF_PORT_DEFAULT);
}

// The address the companion app reaches this at — computed the same way an
// instance's own address is, because the two follow the same tunnel choice.
export function uhfUrl(values) {
  const port = uhfPort(values);
  if (!Number.isFinite(port)) return "";
  const host = isVpnEnabled() ? gluetunContainerName(getComponentValues("gluetun")) : uhfContainerName(values);
  return `http://${host}:${port}`;
}

export async function renderUhfSpec(values) {
  const name = uhfContainerName(values);
  const port = uhfPort(values);
  const recordingsDir = ensureDirectory(componentCacheDir(name));

  const env = {
    ...parseExtraEnv(values.extraEnv),
    ...renderEnv(UHF_SCHEMA, values),
  };
  env.RECORDINGS_DIR = RECORDINGS_MOUNT;

  const spec = {
    name,
    image: values.image || "swapplications/uhf-server:latest",
    env,
    volumes: [`${recordingsDir}:${RECORDINGS_MOUNT}`],
    restartPolicy: "unless-stopped",
  };

  if (isVpnEnabled()) {
    // Inside gluetun's namespace: no networks of its own, and no ports — the
    // daemon rejects both. gluetun publishes the port on its behalf instead,
    // the same way it does for every instance.
    spec.networkMode = `container:${gluetunContainerName(getComponentValues("gluetun"))}`;
  } else {
    spec.networks = String(getComponentValues("postgres").networks || POSTGRES_NETWORKS_FIELD.default)
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    spec.ports = [{ host: port, container: port, protocol: "tcp" }];
  }

  return spec;
}
