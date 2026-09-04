// The VPN watchdog: probes every health-check-enabled instance and, if any of
// them report their provider is blocking the current exit IP, reconnects the
// shared gluetun tunnel — porting the behaviour of the external
// examples/vpn-watchdog/watchdog.sh script (see the stream-share repo) into
// the Suite itself, generalised for several instances sharing one tunnel
// instead of the script's one-instance-one-VPN assumption.
//
// Deliberately keeps no history: a run's only trace is the job log it writes
// to (see reconcile/jobs.js, reused as-is here) — there is no database table
// behind this, by design. "Server reputation" was considered and rejected;
// this only ever reacts to the current, live probe.

import { loadConfig } from "../config.js";
import { fetchHealth } from "../instanceClient.js";
import { reconnectVpn, getPublicIP } from "../gluetunClient.js";
import { getBoolean, getNumber, getSetting } from "../store/settings.js";

export const WATCHDOG_ENABLED_SETTING = "vpn.watchdog_enabled";
export const WATCHDOG_CHECK_TIMES_SETTING = "vpn.watchdog_check_times";
export const WATCHDOG_MAX_RECONNECTS_SETTING = "vpn.watchdog_max_reconnects";

const CHECK_TIMES_DEFAULT = "04:00,16:00";
const MAX_RECONNECTS_DEFAULT = 5;

// Fine-grained pacing is a fixed constant, not a setting — a real choice for
// an operator to make ends around three knobs (on/off, when, how hard to
// retry); the rest is just "how patient is this loop with gluetun settling",
// which the shell script's own defaults already answer well.
//
// Kept as one mutable object rather than plain consts purely as a test seam
// (see _setPacingForTests) — the same idiom as _clearJobsForTests in
// reconcile/jobs.js — so a test proving "it retries 5 times" doesn't also
// have to spend 5x eight real seconds doing it.
export const PACING_MS = {
  healthTimeout: 10000,
  settleWait: 5000,
  settleMax: 20000,
  reconnectSettle: 8000,
};

export function _setPacingForTests(overrides) {
  Object.assign(PACING_MS, overrides);
}

export function isWatchdogEnabled() {
  return getBoolean(WATCHDOG_ENABLED_SETTING, false);
}

export function watchdogCheckTimes() {
  return getSetting(WATCHDOG_CHECK_TIMES_SETTING) || CHECK_TIMES_DEFAULT;
}

export function watchdogMaxReconnects() {
  return Math.max(1, getNumber(WATCHDOG_MAX_RECONNECTS_SETTING, MAX_RECONNECTS_DEFAULT));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function watchedInstances(config) {
  return config.instances.filter((instance) => instance.healthCheckEnabled);
}

// Probes every given instance, never letting one instance's failure stop the
// others. A verdict of "" (rather than a real status) means the instance
// itself could not be reached — same as the shell script, that is never
// treated as "blocked" and never triggers a reconnect on its own.
async function probeAll(instances, log) {
  return Promise.all(
    instances.map(async (instance) => {
      try {
        const { status, detail } = await fetchHealth(instance, { timeoutMs: PACING_MS.healthTimeout });
        log(`${instance.name}: ${status}${detail ? ` (${detail})` : ""}`);
        return { instance, status };
      } catch (err) {
        log(`${instance.name}: could not reach it (${err.message})`);
        return { instance, status: "" };
      }
    })
  );
}

// After a reconnect, a transient error/unknown/unreachable verdict (DNS or
// connectivity still settling while gluetun finishes restarting) is given a
// little time to resolve into a real healthy/blocked verdict rather than
// immediately being treated as still-blocked — mirrors the shell script's
// settle_and_probe.
async function settleAndProbe(instances, log) {
  let waited = 0;
  for (;;) {
    const results = await probeAll(instances, log);
    const unsettled = results.some((r) => r.status !== "healthy" && r.status !== "blocked");
    if (!unsettled || waited >= PACING_MS.settleMax) return results;
    await sleep(PACING_MS.settleWait);
    waited += PACING_MS.settleWait;
  }
}

async function logExitIp(gluetun, log) {
  try {
    const ip = await getPublicIP(gluetun);
    const address = ip.public_ip || ip.ip;
    if (address) log(`Exit IP is now ${address}${ip.country ? ` (${ip.country})` : ""}.`);
  } catch {
    // Purely a log line — nothing downstream depends on this succeeding.
  }
}

// Probes every watched instance and, if any report their provider is
// blocking the current exit IP, reconnects gluetun up to watchdogMaxReconnects()
// times, re-probing after each attempt, until every previously-blocked
// instance is healthy or the budget runs out.
//
// `config` defaults to the real loadConfig() and is only ever overridden by
// tests — real instances live at container DNS names a test process cannot
// reach, so exercising this against fake HTTP servers needs a seam here the
// same way a reconciler render function takes `values` rather than reaching
// into the store itself.
export async function heal({ log = () => {}, config = loadConfig() } = {}) {
  const instances = watchedInstances(config);

  if (instances.length === 0) {
    log("No instance has health checking enabled — nothing to watch.");
    return;
  }
  if (!config.gluetun) {
    log("Gluetun is not configured — cannot act on a blocked provider.");
    return;
  }

  let results = await probeAll(instances, log);
  let blocked = results.filter((r) => r.status === "blocked");

  if (blocked.length === 0) {
    log("Every watched instance's provider looks reachable — nothing to do.");
    return;
  }

  const maxReconnects = watchdogMaxReconnects();
  log(
    `Blocked: ${blocked.map((r) => r.instance.name).join(", ")}. Reconnecting (up to ${maxReconnects} attempt(s)).`
  );

  for (let attempt = 1; attempt <= maxReconnects; attempt++) {
    log(`Reconnect attempt ${attempt}/${maxReconnects}...`);
    try {
      await reconnectVpn(config.gluetun);
    } catch (err) {
      log(`Reconnect failed: ${err.message}`);
    }
    await logExitIp(config.gluetun, log);

    results = await settleAndProbe(instances, log);
    blocked = results.filter((r) => r.status === "blocked");

    if (blocked.length === 0) {
      log(`Recovered after ${attempt} reconnect(s).`);
      return;
    }
    log(`Still blocked: ${blocked.map((r) => r.instance.name).join(", ")}.`);
    if (attempt < maxReconnects) await sleep(PACING_MS.reconnectSettle);
  }

  log(
    `Gave up after ${maxReconnects} reconnect(s); still blocked: ${blocked
      .map((r) => r.instance.name)
      .join(", ")}.`
  );
}
