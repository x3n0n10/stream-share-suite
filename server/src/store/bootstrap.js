// One-time import of an existing environment-variable deployment.
//
// The dashboard this grew out of read INSTANCE_N_* / GLUETUN_* straight from
// the environment. Rather than make existing operators retype all of it, the
// first boot against an empty store copies whatever is in the environment into
// the database and then records that it has done so. It never runs twice: after
// the import the store is the source of truth, and an env var left behind in a
// compose file must not quietly override an edit made in the UI.

import { countInstances, createInstance } from "./instances.js";
import { getSetting, setSetting, setSettings } from "./settings.js";

const MARKER = "bootstrap.imported_at";

function readEnvInstances(env) {
  const found = [];
  for (let n = 1; ; n++) {
    const url = env[`INSTANCE_${n}_URL`];
    if (!url) break;
    found.push({
      name: env[`INSTANCE_${n}_NAME`] || `Instance ${n}`,
      url,
      apiKey: env[`INSTANCE_${n}_API_KEY`] || "",
    });
  }
  return found;
}

const SETTING_FROM_ENV = {
  "general.title": "DASHBOARD_TITLE",
  "general.poll_interval_ms": "POLL_INTERVAL_MS",
  "general.instance_timeout_ms": "INSTANCE_TIMEOUT_MS",
  "general.vod_search_timeout_ms": "VOD_SEARCH_TIMEOUT_MS",
  "general.vod_actor_username": "VOD_ACTOR_USERNAME",
  "gluetun.url": "GLUETUN_URL",
  "gluetun.api_key": "GLUETUN_API_KEY",
  "gluetun.user": "GLUETUN_USER",
  "gluetun.password": "GLUETUN_PASSWORD",
  "gluetun.status_path": "GLUETUN_STATUS_PATH",
  "gluetun.timeout_ms": "GLUETUN_TIMEOUT_MS",
  "gluetun.reconnect_timeout_ms": "GLUETUN_RECONNECT_TIMEOUT_MS",
};

export function bootstrapFromEnv(env = process.env) {
  if (getSetting(MARKER)) return { imported: false, reason: "already-imported" };
  if (countInstances() > 0) {
    setSetting(MARKER, new Date().toISOString());
    return { imported: false, reason: "store-not-empty" };
  }

  const instances = readEnvInstances(env);
  const settings = {};
  for (const [key, envName] of Object.entries(SETTING_FROM_ENV)) {
    const value = env[envName];
    if (value !== undefined && value !== "") settings[key] = value;
  }

  if (instances.length === 0 && Object.keys(settings).length === 0) {
    // Nothing to import — a genuinely fresh install. Leave the marker unset so
    // an operator who adds their old env vars and restarts still gets the
    // import rather than being told they missed their chance.
    return { imported: false, reason: "nothing-to-import" };
  }

  if (Object.keys(settings).length > 0) setSettings(settings);
  for (const instance of instances) createInstance(instance);
  setSetting(MARKER, new Date().toISOString());

  return { imported: true, instances: instances.length, settings: Object.keys(settings).length };
}
