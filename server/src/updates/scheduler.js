// Daily update check. Same wall-clock polling idea as watchdog/scheduler.js:
// a cheap hourly tick decides from stored timestamps whether a run is due, so
// a restart never causes an extra check and a failed run retries within an hour.

import { loadConfig } from "../config.js";
import { collectVersions, versionsInput, resolveSuiteVersion } from "../reconcile/versions.js";
import { createUpstream } from "./upstream.js";
import { isAutoCheckEnabled, runUpdateCheck, settingsStore } from "./check.js";

const HOUR_MS = 60 * 60 * 1000;
const FIRST_TICK_MS = 60 * 1000;

// Pure: is a run due, given the stored result and the setting?
export function isCheckDue({ enabled, result, now = Date.now() }) {
  if (!enabled) return false;
  const age = (iso) => (iso ? now - Date.parse(iso) : Infinity);
  return age(result?.checkedAt) >= 24 * HOUR_MS && age(result?.attemptedAt) >= HOUR_MS;
}

let running = false;

// Runs one check now and returns its stored result, or null when one is already
// running or it failed outright. Never throws; logs one [updates] line on error.
export async function kickUpdateCheck() {
  if (running) return null;
  running = true;
  try {
    const versions = await collectVersions(versionsInput(loadConfig()));
    const upstream = createUpstream({ userAgent: `stream-share-suite/${resolveSuiteVersion()}` });
    return await runUpdateCheck({ versions, upstream });
  } catch (err) {
    console.warn(`[updates] check failed: ${err.message}`);
    return null;
  } finally {
    running = false;
  }
}

function tick() {
  try {
    if (isCheckDue({ enabled: isAutoCheckEnabled(), result: settingsStore.get() })) kickUpdateCheck();
  } catch (err) {
    console.warn(`[updates] tick failed: ${err.message}`);
  }
}

export function startUpdateScheduler() {
  setTimeout(() => {
    tick();
    setInterval(tick, HOUR_MS).unref();
  }, FIRST_TICK_MS).unref();
}
