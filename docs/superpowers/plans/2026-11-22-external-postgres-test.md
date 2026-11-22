# External PostgreSQL Test and Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find out whether the Suite's `external` PostgreSQL mode works as well as `managed` on a fresh install, report it, fix what breaks, and document how to set it up.

**Architecture:** A manual test run on the local dev suite (wiped, newest `main` image) against a stand-in `postgres` container the Suite did not create. Each scenario is driven through the Suite API (or the wizard UI for scenario 1) and checked with `psql` on the stand-in server. Findings go into a PR comment and a new docs section; bugs get their own branch and PR with a failing test first.

**Tech Stack:** Docker + compose on the dev VM, Suite API (Node `fetch` scripts, no `jq`), `psql` inside the stand-in container, Playwright container for the wizard.

**Spec:** `docs/superpowers/specs/2026-11-22-external-postgres-test-design.md`

## Global Constraints

- Test provider only; never the main provider.
- Nothing private in anything pushed: no instance/provider/channel names, hostnames, IPs, credentials. Use `<host-ip>`, "instance A", `example.com`.
- Dev suite credentials live in `/home/user/suite-dev/.env`; never commit it. Test scripts live in the scratchpad, not the repo.
- No new features for external mode (TLS, data migration) unless a scenario shows the mode is unusable without one — then stop and ask the user.
- Docs promise only behaviour a scenario confirmed.
- Every commit in the Suite repo goes through the simplify-guard (`echo simplify-guard:complete '<repo path>'` after the review).

## Review Focus

1. Instance cannot reach a host the Suite can reach (scenario 2): expect a clear apply error or a working instance, not a crash-looping container with no hint in the Suite.
2. Wrong admin password / unreachable host in the wizard: expect the connection test to fail fast with the server's message, not hang for the full ready-retry window.
3. Admin user without `CREATEDB`/`CREATEROLE`: expect `permission denied` surfaced verbatim in the apply log.
4. Stand-in server restarted while the instance runs: expect the instance to reconnect without a Suite apply.
5. Remove with "drop data" while the instance container is already gone: expect database and role dropped, no error.

All five are exercised by Task 2 scenarios; each failing one becomes a Task 3 fix.

---

### Task 1: Fresh dev suite on the newest image, plus the stand-in server

**Files:** none in the repo. Scripts: `<scratchpad>/pgtest/*.mjs`.

**Interfaces:**
- Produces: a running dev suite (no setup done yet) on `:3000` with image built from `origin/main`; stand-in containers `pg-ext` (`postgres:14-alpine`, on network `streamshare`, port 5432 published as 55432) and `pg-ext17` (`postgres:17-alpine`, not on `streamshare`, port published as 55433); a helper `<scratchpad>/pgtest/api.mjs` exporting `login(): Promise<{cookie, csrf}>`, `call(method, path, body?)`, `apply(): Promise<{status, log: string[]}>` (POST `/api/stack/apply`, poll `/api/stack/jobs/<id>`).

- [ ] **Step 1:** `gh workflow run dev-build.yml --ref main`, wait for it to finish green (`gh run watch`).
- [ ] **Step 2:** Wipe per the memory recipe: `docker rm -f` all `streamshare-suite-*` containers, `docker compose down` in `/home/user/suite-dev`, delete `data/` via an alpine container, `docker compose pull && docker compose up -d`. Check: `GET /api/auth/status` reports setup needed; image digest matches the run from Step 1.
- [ ] **Step 3:** Start `pg-ext` and `pg-ext17` with `POSTGRES_PASSWORD` from a value added to `.env` (`PGEXT_PASSWORD`). Check: `docker exec pg-ext psql -U postgres -c 'select 1'` returns 1.
- [ ] **Step 4:** Write `api.mjs`; check `login()` works after first-run setup (done in Task 2 scenario 1, so test it there).

### Task 2: Run the six scenarios and record results

**Files:** none in the repo. Results collected in `<scratchpad>/pgtest/report.md`.

**Interfaces:**
- Consumes: Task 1's containers and `api.mjs`.
- Produces: `report.md`, one section per scenario: what was done, passed/failed, exact error line, and for scenario 6 the observed behaviour. Each failure gets a one-line suspected cause pointing at a file.

For every scenario, "works" means: apply job ends `succeeded`; the instance container is running and healthy; `psql -U postgres -c '\l'` on the server shows database `streamshare_<key>` owned by role `streamshare_<key>`; the instance's own logs show no DB error; playing one live stream through the instance succeeds (test provider).

- [ ] **Scenario 1 — wizard, container name.** Run the setup wizard in the Playwright container (`--network host`): VPN off, Database = External, host `pg-ext`, password from `.env`. Create one instance (test provider). Expect: works.
- [ ] **Scenario 2 — host IP + published port.** Switch Postgres component to host `<host-ip>`, port `55433` (`pg-ext17`, not on `streamshare`). Remove and recreate the instance so it gets a fresh DB there. Expect per Review Focus 1. Record whether the Suite reaches it, whether the instance does, and the error if not.
- [ ] **Scenario 3 — trust auth, empty password.** Recreate `pg-ext17` with `POSTGRES_HOST_AUTH_METHOD=trust`, clear the admin password field, apply. Expect: works; note that the instance role still gets a generated password.
- [ ] **Scenario 4 — weak admin user.** `CREATE ROLE weak LOGIN PASSWORD '...'` (no CREATEDB/CREATEROLE) on `pg-ext`; set it as admin user; add a second instance; apply. Expect per Review Focus 3. Also: wrong password and unreachable host via the wizard's connection test, per Review Focus 2 (time it).
- [ ] **Scenario 5 — lifecycle.** Back on a working config: `docker restart` the instance (reconnects); `docker restart pg-ext` (instance reconnects on its own, Review Focus 4); remove instance keeping data (DB still present); recreate and remove with drop data after `docker rm -f` of the instance container first (Review Focus 5; DB and role gone).
- [ ] **Scenario 6 — managed to external switch.** Wipe again, set up with managed Postgres, create an instance, play a stream (history row exists). Switch to external `pg-ext`, apply. Record: does the instance get an empty DB on the new server; what happens to the managed container (left running? removed? shown as orphan on the Stack page?); does the Suite say anything about the data not moving.
- [ ] **Post the report** as a comment on PR #76 (`gh pr comment 76 --body-file report.md`) after grepping it for private names/IPs. Tell the user the headline results and which failures you plan to fix.

### Task 3: Fix each failure (one branch + PR per bug)

Only for scenarios that failed. Each fix follows superpowers:test-driven-development and the systematic-debugging skill.

**Files:** decided per bug from Task 2's suspected cause; tests next to the touched module under `server/test/` (follow the existing test file for that module).

- [ ] **Step 1:** Branch `fix/<short-name>` from `origin/main`.
- [ ] **Step 2:** Write a failing test reproducing the failure; run `npm test` in `server/` and see it fail for the expected reason.
- [ ] **Step 3:** Fix the root cause in shared code; run `npm test`, all pass.
- [ ] **Step 4:** Build a dev image from the branch, re-run the failed scenario on the dev suite, see it pass.
- [ ] **Step 5:** Simplify review, commit, push, draft PR referencing PR #76. If the fix needs a new feature (Global Constraints), stop and ask the user instead.

### Task 4: Docs section

**Files:**
- Modify: `docs/configuration.md` — new section "Using an external PostgreSQL server", placed after the existing Networking part.
- Modify: `docs/setup-wizard.md:18` — link the new section from the Database step.

**Interfaces:**
- Consumes: `report.md` (only confirmed behaviour goes in).

- [ ] **Step 1:** Write the section covering: what the Suite creates on the server (one database + role per instance, named from the instance key); privileges the admin user needs (`CREATEDB`, `CREATEROLE`, or superuser) and the error otherwise; reachability (instances must reach the host too — from scenarios 1/2: when container name works, when host IP works, how to join the network); password optional with trust auth; removing an instance keeps its database unless "drop data" is chosen; switching from managed moves no data (and what happens to the managed container, per scenario 6). Generic placeholders only.
- [ ] **Step 2:** Check every claim against `report.md`; delete any that no scenario confirmed.
- [ ] **Step 3:** Simplify review, commit on `test/external-postgres`, push, update PR #76 body with a summary (via `gh api -X PATCH repos/x3n0n10/stream-share-suite/pulls/76` if `gh pr edit` fails), mark ready for review only if the user asks.
