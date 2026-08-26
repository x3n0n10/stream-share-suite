// Tracks in-flight and recently-finished apply jobs so the frontend can poll
// a job's progress log while it runs.
//
// In-memory, like the login throttle: the Suite is a single process, and an
// apply is short-lived — losing job history on a restart costs nothing a
// shared store would be worth adding for.

import { randomUUID } from "node:crypto";

const jobs = new Map();

// How long a finished job stays available to be polled one last time before
// it's cleaned up. Long enough that a frontend tab that was in the background
// when the job finished still gets to read the final state.
const RETENTION_MS = 30 * 60 * 1000;

export function createJob(kind) {
  const job = {
    id: randomUUID(),
    kind,
    status: "running",
    log: [],
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
  };
  jobs.set(job.id, job);
  return job;
}

export function appendLog(job, line) {
  job.log.push({ at: Date.now(), line });
}

export function finishJob(job, error) {
  job.status = error ? "failed" : "success";
  job.error = error ? error.message : null;
  job.finishedAt = Date.now();
  setTimeout(() => jobs.delete(job.id), RETENTION_MS).unref();
}

export function getJob(id) {
  return jobs.get(id) || null;
}

// Test seam — jobs are module state by design.
export function _clearJobsForTests() {
  jobs.clear();
}
