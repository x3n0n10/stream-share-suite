# Wait for PostgreSQL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Suite's admin connection to PostgreSQL waits (up to ~60 s) while the server is not up yet, so a first apply that creates PostgreSQL and an instance together no longer fails with `ECONNREFUSED`.

**Architecture:** A small retry helper in `server/src/reconcile/database.js` wraps the connect step of `withAdminClient`. Each attempt builds a fresh `pg.Client` (a pg client cannot be reused after a failed `connect()`). Only "not up yet" errors are retried; queries are never retried. `testConnection` opts out.

**Tech Stack:** Node ≥22 ESM, `pg`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-22-postgres-ready-retry-design.md`

## Global Constraints

- Retry budget about 60 s overall; delay between attempts 1 s.
- Transient = error `code` in `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `ECONNRESET`, SQLSTATE `57P03`, or message `timeout expired` (pg's connect timeout). Everything else fails on the first attempt.
- Log line, written once, on the first retry: `Waiting for PostgreSQL to accept connections...`
- Exhausted error message: `PostgreSQL at <host>:<port> did not accept connections within <N> s: <last error message>`
- `testConnection` never retries.
- No Docker changes. Nothing private (instance/provider names, hosts) in code, tests or commits.

## Review Focus

- Wrong admin password (SQLSTATE `28P01`) must fail immediately, not after 60 s — test in Task 1.
- A failed attempt must not leak a half-open client: each failed client gets `end()` called (errors from `end()` ignored). Lives inside `withAdminClient`'s `open`, which needs a real `pg` — reviewer checks it, and Task 2 exercises it live.
- Budget exhaustion must surface the last real error text, not a generic "timed out" — test in Task 1.
- The "Waiting..." line must appear only once per connect, not once per attempt — test in Task 1.
- `serverVersion`/`dropDatabase` callers that pass no `log` must still work (default no-op) — covered by the default parameter; reviewer checks.

---

### Task 1: Retrying admin connect

**Files:**
- Modify: `server/src/reconcile/database.js` (`withAdminClient`, `ensureDatabase`, `testConnection`)
- Create: `server/test/database-retry.test.js`

**Interfaces:**
- Produces (exported from `database.js`):
  - `isNotUpYet(err: Error) -> boolean`
  - `connectWithRetry(open: () => Promise<Client>, { budgetMs = 60000, delayMs = 1000, log = () => {}, sleep = (ms) => setTimeout-promise, describe = "PostgreSQL" } = {}) -> Promise<Client>` — `open` creates **and connects** a fresh client; on a failed attempt `connectWithRetry` does nothing to the client itself (`open` is responsible for ending the client it created when its own `connect()` rejects). `describe` is the `<host>:<port>` text used in the exhausted message.
  - `withAdminClient(target, fn, { retry = true, log = () => {} } = {})` — internal, signature change only.

- [ ] **Step 1: Write the failing tests** in `server/test/database-retry.test.js`

```js
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
```

(If the implementer prefers injecting a `now` option over stubbing `Date.now`, add `now = Date.now` to the options and use it in the test instead — either is fine.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && node --test test/database-retry.test.js`
Expected: FAIL — `isNotUpYet` / `connectWithRetry` not exported.

- [ ] **Step 3: Implement** `isNotUpYet` and `connectWithRetry` in `database.js`, then rework `withAdminClient`:
  - `open` builds `new pg.Client({...same options as today...})`, awaits `connect()`, and on rejection calls `client.end().catch(() => {})` before rethrowing.
  - `retry: false` calls `open()` once (no helper).
  - `describe` = `` `${target.host}:${target.port}` ``.
  - `ensureDatabase` passes its `log` to `withAdminClient`; `testConnection` passes `{ retry: false }`.
  - Keep every existing comment in the file.

- [ ] **Step 4: Run the new and full suites**

Run: `cd server && node --test test/database-retry.test.js && npm test`
Expected: all PASS.

- [ ] **Step 5: Commit** (run the simplify review first — the repo's simplify-guard hook blocks the commit otherwise)

```bash
git add server/src/reconcile/database.js server/test/database-retry.test.js
git commit -m "fix(reconcile): wait for PostgreSQL to accept connections before creating instance databases"
```

### Task 2: End-to-end check on the dev stack

No code. Proves the fix against the reproduction from the spec.

- [ ] **Step 1:** Push the branch and build a dev image: `gh workflow run dev-build.yml --ref fix/postgres-ready-retry -R x3n0n10/stream-share-suite`; wait for it to succeed.
- [ ] **Step 2:** On the dev VM, point `/home/user/suite-dev/docker-compose.yml` at `stream-share-suite:dev`, `docker compose pull && docker compose up -d`.
- [ ] **Step 3:** Remove the postgres and instance containers, delete `data/postgres` (via an alpine container, it is root-owned), run a stack apply (scratchpad `apply.mjs`).
Expected: apply log shows `Waiting for PostgreSQL to accept connections...` (or no wait if postgres was quick), then `Creating database role ...`, and `STATUS succeeded`; the instance container ends up `healthy`.
- [ ] **Step 4:** Report the timed log in the PR.
