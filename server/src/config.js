// Runtime configuration, read from the store on every request rather than
// captured at boot.
//
// This is the change that phase 0 exists for: the dashboard used to freeze
// INSTANCE_N_* into a module-level object at startup, so adding an instance
// meant editing a compose file and recreating a container. Reading per request
// means an edit in the UI takes effect on the next poll.

import { listInstances } from "./store/instances.js";
import { listComponents, getComponentValues } from "./store/components.js";
import { instanceUrl, instanceContainerName } from "./reconcile/instance.js";
import { isVpnEnabled } from "./reconcile/catalog.js";
import { gluetunContainerName } from "./reconcile/gluetun.js";
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
  // An operator who lets the reconciler create gluetun (the Stack page) never
  // has to type its address in a second time here: with no explicit URL, fall
  // back to the same container name and fixed port renderGluetunSpec creates
  // it under (see reconcile/gluetun.js), authenticated with the same
  // per-install API key the reconciler gave it — gluetun's control server
  // rejects every route with no auth configured at all, so "unauthenticated"
  // is not actually an option any more. An explicit gluetun.url/api_key below
  // always wins — that is what an adopted/external gluetun with its own real
  // auth still needs.
  let url = (getSetting("gluetun.url") || "").replace(/\/+$/, "");
  let managedApiKey = "";
  if (!url) {
    // Only once the operator has actually filled in gluetun's own form on the
    // Stack page — never on isVpnEnabled()'s bare default (true on a totally
    // fresh install), which would otherwise report a VPN page "enabled"
    // against a gluetun container that doesn't exist yet.
    const gluetunValues = getComponentValues("gluetun");
    if (isVpnEnabled() && Object.keys(gluetunValues).length > 0) {
      url = `http://${gluetunContainerName(gluetunValues)}:8000`;
      managedApiKey = gluetunValues._controlServerApiKey || "";
    }
  }
  if (!url) return null;

  const user = getSetting("gluetun.user") || "";
  const password = getSetting("gluetun.password") || "";

  return {
    url,
    apiKey: getSetting("gluetun.api_key") || managedApiKey,
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
      // Only a Suite-managed instance has these — an externally-added one
      // (store/instances.js, predating the schema system) has no equivalent
      // form and is simply never watched by the VPN watchdog.
      healthCheckEnabled: !!values.healthCheckEnabled,
      healthCheckStreamId: values.healthCheckStreamId || "",
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
