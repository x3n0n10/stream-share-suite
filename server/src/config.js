// Runtime configuration, read from the store on every request rather than
// captured at boot.
//
// This is the change that phase 0 exists for: the dashboard used to freeze
// INSTANCE_N_* into a module-level object at startup, so adding an instance
// meant editing a compose file and recreating a container. Reading per request
// means an edit in the UI takes effect on the next poll.

import { listInstances } from "./store/instances.js";
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
    instances: listInstances(),
    gluetun: readGluetun(),
  };
}
