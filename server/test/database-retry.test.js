import { test } from "node:test";
import assert from "node:assert/strict";
import { isNotUpYet, connectWithRetry } from "../src/reconcile/database.js";

const err = (props, message = "x") => Object.assign(new Error(message), props);
const noSleep = async () => {};

test("not-up-yet errors are recognised, real ones are not", () => {
  for (const e of [err({ code: "ECONNREFUSED" }), err({ code: "ENOTFOUND" }), err({ code: "EAI_AGAIN" }),
                   err({ code: "ECONNRESET" }), err({ code: "57P03" }), err({}, "timeout expired")]) {
    assert.equal(isNotUpYet(e), true, e.code || e.message);
  }
  for (const e of [err({ code: "28P01" }), err({ code: "3D000" }), err({}, "boom")]) {
    assert.equal(isNotUpYet(e), false, e.code || e.message);
  }
});

test("retries refused connects until one succeeds, logging the wait once", async () => {
  let calls = 0; const lines = [];
  const client = await connectWithRetry(async () => {
    calls++;
    if (calls < 3) throw err({ code: "ECONNREFUSED" });
    return "client";
  }, { sleep: noSleep, log: (l) => lines.push(l) });
  assert.equal(client, "client");
  assert.equal(calls, 3);
  assert.deepEqual(lines, ["Waiting for PostgreSQL to accept connections..."]);
});

test("a wrong password fails on the first attempt", async () => {
  let calls = 0;
  await assert.rejects(
    connectWithRetry(async () => { calls++; throw err({ code: "28P01" }, "password authentication failed"); }, { sleep: noSleep }),
    /password authentication failed/
  );
  assert.equal(calls, 1);
});

test("gives up after the budget with the last error in the message", async () => {
  let now = 0;
  const sleep = async (ms) => { now += ms; };
  const realNow = Date.now;
  Date.now = () => now;
  try {
    await assert.rejects(
      connectWithRetry(async () => { throw err({ code: "ECONNREFUSED" }, "connect ECONNREFUSED 10.0.0.1:5432"); },
        { sleep, budgetMs: 5000, delayMs: 1000, describe: "db:5432" }),
      /^Error: PostgreSQL at db:5432 did not accept connections within 5 s: connect ECONNREFUSED 10\.0\.0\.1:5432$/
    );
  } finally { Date.now = realNow; }
});
