# Wait for PostgreSQL to accept connections — design

Small change.

## Intent

On a fresh install the first apply can fail with `connect ECONNREFUSED <postgres-ip>:5432`.
The reconciler starts the managed PostgreSQL container and moves straight on to the first
instance, whose `prepareInstance` immediately connects to create the instance's database
and role. A fresh postgres container runs `initdb`, starts a temporary socket-only server,
shuts it down and restarts; it only accepts TCP connections after that (about 1.6 s on the
dev VM, longer on slow disks). The Suite connects once, with no retry, so the apply fails.

Reproduced on a clean dev stack: postgres started at +1.01 s, the Suite connected at
+1.82 s and got `ECONNREFUSED`. The first apply only succeeds when pulling the instance
image happens to take long enough to cover postgres' startup.

## Goals

- An apply that creates PostgreSQL and instances in one go succeeds without manual retries.
- Also covers a postgres that is restarting, and an external server that is still booting.

## Non-goals / anti-goals

- No retry on real errors: wrong password, missing role, permission denied, bad SQL must
  still fail immediately with their own message, not after a minute of waiting.
- No Docker changes (healthchecks, socket proxy permissions).
- StreamShare's own startup DB check is out of scope.

## Approaches

1. **Retry the admin connection in `server/src/reconcile/database.js` (picked).** One shared
   place (`withAdminClient`), so every caller — `prepareInstance`, `serverVersion`,
   `dropDatabase`, `testConnection` — benefits. Retries only "not up yet" errors for a
   bounded time. Small, no Docker changes, works for managed and external servers.
2. Docker healthcheck on the postgres container and wait for `healthy`. Gives UI
   visibility, but only covers the managed server and needs more code.
3. Make StreamShare retry at startup. Does not fix this failure, which happens in the Suite
   before the instance container exists.

## Design

- `withAdminClient` retries `client.connect()` while the error is transient, with a short
  fixed delay between attempts, up to an overall budget of about 60 s. Only the connect is
  retried, never the queries that follow it.
- Transient = Node `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `ECONNRESET`, connection timeout,
  and Postgres SQLSTATE `57P03` ("the database system is starting up").
- When the budget runs out, the last error is thrown with a message saying the Suite waited
  for PostgreSQL and how long, so the apply log explains itself.
- A log line ("Waiting for PostgreSQL to accept connections...") is written once when the
  first retry happens, so a slow apply doesn't look hung. `ensureDatabase` passes its `log`.
- `testConnection` (the UI's "test connection" button) keeps failing fast: it opts out of
  retrying, since a person is waiting on it and wants the real answer now.

## Left to the builder

- Exact delay (around 500 ms–1 s) and whether the budget is a constant or injectable for tests.
- Test: a unit test with a fake client that refuses N times then connects, plus one that
  fails with a non-transient error and is not retried.
