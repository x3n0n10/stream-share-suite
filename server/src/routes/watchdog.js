// The VPN watchdog's HTTP surface: its three settings, a manual trigger, and
// polling the job it runs as — see watchdog/vpnWatchdog.js for what it does
// and why it keeps no history of its own.

import { Router } from "express";
import { setSetting } from "../store/settings.js";
import {
  isWatchdogEnabled,
  watchdogCheckTimes,
  watchdogMaxReconnects,
  WATCHDOG_ENABLED_SETTING,
  WATCHDOG_CHECK_TIMES_SETTING,
  WATCHDOG_MAX_RECONNECTS_SETTING,
} from "../watchdog/vpnWatchdog.js";
import { runWatchdogJob, getLastWatchdogJobId, parseCheckTimes } from "../watchdog/scheduler.js";
import { getJob } from "../reconcile/jobs.js";

const MAX_RECONNECTS_CAP = 20;

function watchdogSettings() {
  return {
    enabled: isWatchdogEnabled(),
    checkTimes: watchdogCheckTimes(),
    maxReconnects: watchdogMaxReconnects(),
  };
}

export function createWatchdogRouter() {
  const router = Router();

  router.get("/settings", (req, res) => {
    res.json(watchdogSettings());
  });

  router.put("/settings", (req, res) => {
    if (typeof req.body?.enabled === "boolean") {
      setSetting(WATCHDOG_ENABLED_SETTING, req.body.enabled ? "true" : "false");
    }

    if (req.body?.checkTimes !== undefined) {
      const trimmed = String(req.body.checkTimes).trim();
      if (!trimmed || parseCheckTimes(trimmed).length === 0) {
        return res.status(400).json({
          error: "Check times must be a comma-separated list of HH:MM times, e.g. 04:00,16:00.",
        });
      }
      setSetting(WATCHDOG_CHECK_TIMES_SETTING, trimmed);
    }

    if (req.body?.maxReconnects !== undefined) {
      const value = Number(req.body.maxReconnects);
      if (!Number.isInteger(value) || value < 1 || value > MAX_RECONNECTS_CAP) {
        return res.status(400).json({
          error: `Max reconnects must be a whole number between 1 and ${MAX_RECONNECTS_CAP}.`,
        });
      }
      setSetting(WATCHDOG_MAX_RECONNECTS_SETTING, value);
    }

    res.json(watchdogSettings());
  });

  // Fire-and-forget, same shape as the reconciler's own applies: answer with
  // the job id immediately rather than holding the request open for however
  // long a reconnect loop takes.
  router.post("/run", (req, res) => {
    const job = runWatchdogJob();
    res.status(202).json({ jobId: job.id });
  });

  router.get("/jobs/:jobId", (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Unknown job" });
    res.json(job);
  });

  // The most recent run's job id, scheduled or manual, so the VPN page can
  // show what happened last time even if nobody had it open when it ran.
  // In-memory only (see getLastWatchdogJobId) — it resets on restart, which
  // is fine for something diagnostic rather than a record.
  router.get("/last-job", (req, res) => {
    res.json({ jobId: getLastWatchdogJobId() });
  });

  return router;
}
