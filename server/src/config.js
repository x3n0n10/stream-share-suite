// Runtime configuration, read from the store on every request rather than
// captured at boot.
//
// This is the change that phase 0 exists for: the dashboard used to freeze
// INSTANCE_N_* into a module-level object at startup, so adding an instance
// meant editing a compose file and recreating a container. Reading per request
// means an edit in the UI takes effect on the next poll.

import { listInstances } from "./store/instances.js";
import { listComponents } from "./store/components.js";
import { instanceUrl, instanceContainerName } from "./reconcile/instance.js";
import { getNumber, getSetting } from "./store/settings.js";

export const DEFAULTS = {
  title: "StreamShare Suite",
  pollIntervalMs: 15000,
  requestTimeoutMs: 6000,
  vodSearchTimeoutMs: 30000,
  vodActorUsername: "suite",
};

// Gluetun's control server accepts either an API key or basic auth depending on
// its roles config, so both are stored and basic auth wins when both are set —
// a client maps to exactly one method.
function readGluetun() {
  const url = (getSetting("gluetun.url") || "").replace(/\/+$/, "");
  if (!url) return null;

  const user = getSetting("gluetun.user") || "";
  const password = getSetting("gluetun.password") || "";

  return {
    url,
    apiKey: getSetting("gluetun.api_key") || "",
    basicAuth: user && password ? { user, password } : null,
    statusPath: getSetting("gluetun.status_path") || "/v1/vpn/status",
    timeoutMs: Math.max(1000, getNumber("gluetun.timeout_ms", 5000)),
    reconnectTimeoutMs: Math.max(15000, getNumber("gluetun.reconnect_timeout_ms", 45000)),
  };
}

// Instances the Suite created, projected into the same shape the ops layer
// already reads for the ones you typed in by hand.
//
// Derived on every read rather than copied into the instances table, so there
// is no second source of truth to keep in sync — and no way for the two to
// disagree after a port changes or the VPN is switched off. Both are what an
// instance's URL is computed from, which is why nobody types one.
function managedInstances() {
  return listComponents("instance").map((row, index) => {
    const values = JSON.parse(row.config_json);
    return {
      id: row.key,
      name: values.displayName || row.key,
      url: instanceUrl(row.key, values),
      apiKey: values._apiKey || "",
      position: 1000 + index,
      enabled: true,
      managed: true,
      containerName: instanceContainerName(row.key, values),
    };
  });
}

export function loadConfig() {
  return {
    title: getSetting("general.title") || DEFAULTS.title,
    pollIntervalMs: Math.max(5000, getNumber("general.poll_interval_ms", DEFAULTS.pollIntervalMs)),
    requestTimeoutMs: Math.max(
      1000,
      getNumber("general.instance_timeout_ms", DEFAULTS.requestTimeoutMs)
    ),
    // VOD search hits the instance's upstream Xtream provider live rather than
    // its in-memory state, so it gets a longer budget of its own instead of
    // forcing every other endpoint to wait as long.
    vodSearchTimeoutMs: Math.max(
      5000,
      getNumber("general.vod_search_timeout_ms", DEFAULTS.vodSearchTimeoutMs)
    ),
    vodActorUsername: getSetting("general.vod_actor_username") || DEFAULTS.vodActorUsername,
    // Externally-configured instances first, then the ones the Suite runs.
    instances: [...listInstances(), ...managedInstances()],
    gluetun: readGluetun(),
  };
}
