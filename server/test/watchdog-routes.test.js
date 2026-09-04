// End-to-end over real HTTP for /api/watchdog: settings, the manual trigger,
// and polling the job it runs as. heal() itself is proven in
// vpnWatchdog.test.js — this file only proves the routes are wired correctly.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase, signedInClient, apiClient } from "./helpers.js";
import { createApp } from "../src/app.js";
import { _resetLoginThrottle } from "../src/auth/middleware.js";
import { _clearJobsForTests } from "../src/reconcile/jobs.js";
import { _resetLastWatchdogJobForTests } from "../src/watchdog/scheduler.js";

let appServer;
let base;

before(async () => {
  appServer = createApp({ serveStatic: false }).listen(0);
  await new Promise((resolve) => appServer.once("listening", resolve));
  base = `http://127.0.0.1:${appServer.address().port}`;
});

after(() => appServer.close());

beforeEach(() => {
  freshDatabase();
  _resetLoginThrottle();
  _clearJobsForTests();
  _resetLastWatchdogJobForTests();
});

async function waitForJob(client, jobId, { timeoutMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { body } = await client.get(`/api/watchdog/jobs/${jobId}`);
    if (body.status !== "running") return body;
    if (Date.now() > deadline) throw new Error("job did not finish in time");
    await new Promise((r) => setTimeout(r, 10));
  }
}

test("default settings are off, with the shell script's own default schedule", async () => {
  const c = await signedInClient(base);
  const res = await c.get("/api/watchdog/settings");
  assert.deepEqual(res.body, { enabled: false, checkTimes: "04:00,16:00", maxReconnects: 5 });
});

test("settings round-trip through a save", async () => {
  const c = await signedInClient(base);
  const res = await c.put("/api/watchdog/settings", {
    enabled: true,
    checkTimes: "02:00,14:00",
    maxReconnects: 3,
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { enabled: true, checkTimes: "02:00,14:00", maxReconnects: 3 });

  const reread = await c.get("/api/watchdog/settings");
  assert.deepEqual(reread.body, res.body);
});

test("rejects check times that don't parse as HH:MM", async () => {
  const c = await signedInClient(base);
  const res = await c.put("/api/watchdog/settings", { checkTimes: "not a time" });
  assert.equal(res.status, 400);
});

test("rejects a max reconnects outside 1..20", async () => {
  const c = await signedInClient(base);
  const zero = await c.put("/api/watchdog/settings", { maxReconnects: 0 });
  assert.equal(zero.status, 400);

  const tooMany = await c.put("/api/watchdog/settings", { maxReconnects: 21 });
  assert.equal(tooMany.status, 400);
});

test("a manual run completes as a job, with nothing configured to watch", async () => {
  const c = await signedInClient(base);
  const started = await c.post("/api/watchdog/run", {});
  assert.equal(started.status, 202);
  assert.ok(started.body.jobId);

  const job = await waitForJob(c, started.body.jobId);
  assert.equal(job.status, "success");
  assert.ok(job.log.some((entry) => entry.line.includes("nothing to watch")));
});

test("last-job reflects the most recent run", async () => {
  const c = await signedInClient(base);
  assert.equal((await c.get("/api/watchdog/last-job")).body.jobId, null);

  const started = await c.post("/api/watchdog/run", {});
  await waitForJob(c, started.body.jobId);

  assert.equal((await c.get("/api/watchdog/last-job")).body.jobId, started.body.jobId);
});

test("polling an unknown job id is a 404", async () => {
  const c = await signedInClient(base);
  const res = await c.get("/api/watchdog/jobs/no-such-job");
  assert.equal(res.status, 404);
});

test("the watchdog routes are behind the auth gate like everything else", async () => {
  const res = await apiClient(base).get("/api/watchdog/settings");
  assert.equal(res.status, 401);
});
