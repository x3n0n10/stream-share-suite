import { test } from "node:test";
import assert from "node:assert/strict";
import { createJob, appendLog, finishJob, _clearJobsForTests } from "../src/reconcile/jobs.js";
import { jobResult } from "../src/watchdog/scheduler.js";
import { SuiteError } from "../src/errors.js";

test("appendLog stores code and params", () => {
  _clearJobsForTests();
  const job = createJob("x");
  appendLog(job, "Pulled x", { code: "image_pulled", params: { image: "x" } });
  appendLog(job, "Plain");
  assert.equal(job.log[0].code, "image_pulled");
  assert.deepEqual(job.log[0].params, { image: "x" });
  assert.equal(job.log[1].code, undefined);
});

test("finishJob keeps a SuiteError's code", () => {
  const job = createJob("x");
  finishJob(job, new SuiteError("port_clash", "Port 9000 clashes", { port: 9000 }));
  assert.deepEqual(job.errorI18n, { code: "port_clash", params: { port: 9000 } });
  const plain = createJob("x");
  finishJob(plain, new Error("boom"));
  assert.equal(plain.errorI18n, undefined);
});

test("jobResult keeps codes", () => {
  const job = createJob("x");
  appendLog(job, "Pulled x", { code: "image_pulled", params: { image: "x" } });
  finishJob(job, new SuiteError("port_clash", "m", { port: 1 }));
  const result = jobResult(job);
  assert.equal(result.log[0].code, "image_pulled");
  assert.equal(result.errorI18n.code, "port_clash");
});

test("finishJob ignores the code on a non-SuiteError", () => {
  const job = createJob("x");
  finishJob(job, Object.assign(new Error("connect failed"), { code: "ECONNREFUSED" }));
  assert.equal(job.errorI18n, undefined);
});
