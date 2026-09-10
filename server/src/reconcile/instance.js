// Renders a StreamShare instance to a container spec.
//
// This is where the VPN toggle stops being a setting and becomes two different
// containers. With the VPN on the instance joins gluetun's network namespace
// and publishes nothing itself — Docker forbids a container in that state from
// binding host ports, so gluetun publishes on its behalf (see gluetun.js).
// With it off the instance sits on an ordinary network and publishes its own.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { INSTANCE_SCHEMA } from "../schema/instance.js";
import { POSTGRES_SCHEMA } from "../schema/postgres.js";
import { renderEnv } from "../schema/registry.js";
import { getComponentValues, listComponents, saveComponentValues } from "../store/components.js";
import { getNumber } from "../store/settings.js";
import { componentDataDir, ensureDirectory, ownershipString } from "../store/paths.js";
import { isVpnEnabled } from "./catalog.js";
import { gluetunContainerName } from "./gluetun.js";
import { connectionTarget } from "./postgres.js";
import { parseExtraEnv } from "./env.js";
import { containerPrefix } from "./prefix.js";

// Where stream-share keeps things inside its own container. Fixed rather than
// configurable: they are the image's own paths, not a preference.
const CONFIG_MOUNT = "/root";
const CACHE_MOUNT = "/cache";

// The band instance ports are allocated from. 20 slots is wide enough for far
// more providers than anyone runs, narrow enough to stay memorable; only the
// starting port is a setting, so the host can move the whole band somewhere
// free without the Suite having to reason about a variable-width one.
export const PORT_BAND_WIDTH = 20;
export const PORT_BAND_START_SETTING = "stack.instance_port_start";
const PORT_BAND_START_DEFAULT = 8080;

// Read fresh each time rather than cached, same as every other setting —
// changing it never renumbers an instance that already has a port (see
// allocatePort below), only where the *next* one is searched for.
export function portBand() {
  const first = getNumber(PORT_BAND_START_SETTING, PORT_BAND_START_DEFAULT);
  return { first, last: first + PORT_BAND_WIDTH - 1 };
}

const POSTGRES_NETWORKS_FIELD = POSTGRES_SCHEMA.fields.find((f) => f.key === "networks");

export function instanceContainerName(key, values = {}) {
  return String(values.containerName || "").trim() || `${containerPrefix()}${key}`;
}

// Every port already spoken for, across every stored instance. Used both to
// allocate a new one and to report a clash on an overridden one.
export function allocatedPorts({ exceptKey = null } = {}) {
  const taken = new Map();
  for (const row of listComponents("instance")) {
    if (row.key === exceptKey) continue;
    const port = Number(JSON.parse(row.config_json).port);
    if (Number.isFinite(port) && port > 0) taken.set(port, row.key);
  }
  return taken;
}

// Allocation is sticky by construction: it only ever runs when an instance has
// no port yet, so adding a fifth instance never renumbers the first four. A
// renumber would recreate healthy containers to change nothing, and break
// anything already pointing at them.
export function allocatePort() {
  const taken = allocatedPorts();
  const band = portBand();
  for (let port = band.first; port <= band.last; port++) {
    if (!taken.has(port)) return port;
  }
  return null;
}

// The one deliberate exception to "moving the band never renumbers an
// instance that already has a port" (see portBand above): an instance whose
// port falls entirely outside the *new* band would otherwise sit at a port
// nothing points at it by. Called by the settings route only, before the
// setting itself is written — never partially: if there isn't room for
// every stray instance in the new band, nothing is reassigned and the
// caller should refuse the whole range change. Only rewrites stored config,
// the same as any manual field edit; the resulting container recreation
// still waits for the operator to review and apply the plan.
export function reassignOutOfRangeInstances(newBand) {
  const rows = listComponents("instance");
  const kept = new Set();
  const stray = [];
  for (const row of rows) {
    const values = JSON.parse(row.config_json);
    const port = Number(values.port);
    if (!Number.isFinite(port) || port <= 0) continue;
    if (port >= newBand.first && port <= newBand.last) {
      kept.add(port);
    } else {
      stray.push({ key: row.key, values, from: port });
    }
  }
  if (stray.length === 0) return [];

  const free = [];
  for (let port = newBand.first; port <= newBand.last && free.length < stray.length; port++) {
    if (!kept.has(port)) free.push(port);
  }
  if (free.length < stray.length) {
    throw new Error(
      `${stray.length} instance(s) fall outside the new range and only ${free.length} free slot(s) are available there — widen the range or remove instances first.`
    );
  }

  return stray.map(({ key, values, from }, i) => {
    const to = free[i];
    saveComponentValues("instance", { ...values, port: to }, key);
    return { key, from, to };
  });
}

// The address the Suite's own dashboard reaches this instance at — computed,
// never typed. With the VPN on every instance answers on gluetun's address at
// its own port; with it off each answers on its own container name.
export function instanceUrl(key, values) {
  const port = Number(values.port);
  if (!Number.isFinite(port)) return "";
  const host = isVpnEnabled() ? gluetunContainerName(getComponentValues("gluetun")) : instanceContainerName(key, values);
  return `http://${host}:${port}`;
}

export async function renderInstanceSpec(values, key) {
  const name = instanceContainerName(key, values);
  const port = Number(values.port);

  const configDir = ensureDirectory(componentDataDir(name), "config");
  // Unlike configDir, the cache path is never created or checked by the
  // Suite itself — it's handed straight to Docker as a bind-mount source,
  // the same as any path in a hand-written compose file. That's what lets
  // an operator point it at a new disk without ever touching the Suite's
  // own compose file (see the README's "Where component data lives"
  // section for the reasoning).
  const cachingOn = values.vodCacheEnabled === "true" || values.catchupEnabled === "true";
  const cacheDir = cachingOn ? values.cachePath : null;

  const env = {
    ...parseExtraEnv(values.extraEnv),
    ...renderEnv(INSTANCE_SCHEMA, values),
  };

  // Computed rather than asked for — see the schema's header for why each one
  // is not a field.
  env.PORT = String(port);
  env.INSTANCE_NAME = values.displayName || key;
  if (cachingOn) env.CACHE_FOLDER = CACHE_MOUNT;
  env.LDAP_ENABLED = values.authMode === "ldap" ? "true" : "false";
  if (values._apiKey) env.INTERNAL_API_KEY = values._apiKey;
  // Discord needs the same externally-reachable address stream-share's own
  // players already use — see schema/instance.js's Discord group header for
  // why this isn't a field asked for a second time.
  if (values.discordEnabled) env.DISCORD_API_URL = values.publicBaseUrl;

  // Written into the config mount every instance already has, rather than a
  // volume of its own — see the schema's "error slates" header for why the
  // path itself isn't a field. Enabled with no custom messages just sends
  // ERROR_SLATE_ENABLED, leaning on the image's own defaults.
  if (values.errorSlateEnabled && String(values.errorSlateMessages || "").trim()) {
    writeFileSync(path.join(configDir, "error-slate-messages.json"), values.errorSlateMessages);
    env.ERROR_SLATE_MESSAGES_FILE = `${CONFIG_MOUNT}/error-slate-messages.json`;
  }

  // Fixed rather than asked, once health checking is on: the VPN watchdog
  // schedules probes itself (see watchdog/vpnWatchdog.js), so a second
  // self-probe schedule here would just hit the provider twice for the same
  // information. HEALTHCHECK_MIN_INTERVAL_SECONDS still needs to be short —
  // not zero — so a forced probe during a heal actually gets a fresh read
  // rather than a stale cached one from before the last reconnect.
  if (values.healthCheckEnabled) {
    env.HEALTHCHECK_TIMES = "";
    env.HEALTHCHECK_MIN_INTERVAL_SECONDS = "10";
  }

  const database = connectionTarget(getComponentValues("postgres"));
  if (database.host) {
    env.DB_HOST = database.host;
    env.DB_PORT = String(database.port);
    env.DB_NAME = values._dbName || "";
    env.DB_USER = values._dbUser || "";
    env.DB_PASSWORD = values._dbPassword || "";
  }

  const spec = {
    name,
    image: values.image || "ghcr.io/x3n0n10/stream-share:latest",
    env,
    volumes: [
      `${configDir}:${CONFIG_MOUNT}`,
      ...(cacheDir ? [`${cacheDir}:${CACHE_MOUNT}`] : []),
    ],
    // The image runs as a non-root user and never chowns what it is given, so
    // it has to run as whoever owns the directories above — which is the Suite.
    user: ownershipString(),
    restartPolicy: "unless-stopped",
  };

  if (isVpnEnabled()) {
    // Inside gluetun's namespace: no networks of its own, and no ports — the
    // daemon rejects both. gluetun carries the published port instead.
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
