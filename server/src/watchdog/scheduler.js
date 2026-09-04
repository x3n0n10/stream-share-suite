// Runs the VPN watchdog on its own schedule, and exposes the same run as a
// job whether it fired on the clock or was triggered manually from the API —
// one code path, one place the log ends up.
//
// This is the second real recurring background job in the whole codebase,
// after the daily session-pruning interval in index.js. No cron library: the
// wall-clock-polling technique below is exactly what the external watchdog.sh
// script this replaces already used, for the same reason it gave — `date -d`
// style parsing isn't available everywhere, and isn't needed for "does the
// current HH:MM match one of a handful of configured times".

import { createJob, appendLog, finishJob } from "../reconcile/jobs.js";
import { heal, isWatchdogEnabled, watchdogCheckTimes } from "./vpnWatchdog.js";

const POLL_MS = 30 * 1000;

let lastJobId = null;

export function getLastWatchdogJobId() {
  return lastJobId;
}

// Test seam — like _clearJobsForTests in reconcile/jobs.js, this is module
// state by design and needs resetting between tests that care about it.
export function _resetLastWatchdogJobForTests() {
  lastJobId = null;
}

// Parses "HH:MM,HH:MM" into minutes-since-midnight, dropping anything that
// doesn't parse rather than failing the whole schedule over one bad entry.
export function parseCheckTimes(raw) {
  const minutes = [];
  for (const part of String(raw || "").split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
    if (!match) continue;
    const hours = Number(match[1]);
    const mins = Number(match[2]);
    if (hours >= 0 && hours <= 23 && mins >= 0 && mins <= 59) {
      minutes.push(hours * 60 + mins);
    }
  }
  return minutes;
}

// Runs heal() as a background job, the same way the reconciler's own applies
// do (see reconcile/jobs.js / routes/stack.js's startJob) — fire-and-forget,
// answering with the job id immediately rather than holding a request open
// for however long a reconnect loop takes.
export function runWatchdogJob() {
  const job = createJob("vpn-watchdog");
  lastJobId = job.id;

  (async () => {
    try {
      await heal({ log: (line) => appendLog(job, line) });
      finishJob(job, null);
    } catch (err) {
      appendLog(job, `Error: ${err.message}`);
      finishJob(job, err);
    }
  })();

  return job;
}

export function startWatchdogScheduler() {
  if (isWatchdogEnabled()) runWatchdogJob();

  // Guards against firing twice inside the same minute while still allowed to
  // fire again the next day at the same clock time.
  let lastFiredStamp = null;

  setInterval(() => {
    if (!isWatchdogEnabled()) return;

    const now = new Date();
    const stamp = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
    if (stamp === lastFiredStamp) return;

    const currentMinute = now.getHours() * 60 + now.getMinutes();
    if (parseCheckTimes(watchdogCheckTimes()).includes(currentMinute)) {
      lastFiredStamp = stamp;
      runWatchdogJob();
    }
  }, POLL_MS).unref();
}
