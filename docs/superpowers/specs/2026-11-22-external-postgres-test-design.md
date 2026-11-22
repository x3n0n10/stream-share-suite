# Test the external PostgreSQL mode, and document it — design

Small change.

## Intent

The Postgres component has two modes: `managed` (the Suite runs a postgres container) and
`external` (the Suite connects to a server the operator already runs). Only managed has been
exercised for real. External mode is there for other operators who already run PostgreSQL,
so the goal is to find out whether it works as well as managed for them, fix what does not,
and tell them what they need to know to set it up.

## Goals

- Find out whether a fresh install that starts with an external server works end to end:
  setup wizard, instance creation, apply, restart, removal with and without dropping data.
- Fix any bug found, in its own PR.
- Add an "Using an external PostgreSQL server" section to `docs/configuration.md`.

## Non-goals / anti-goals

- No automated integration test in CI (considered, see Approaches).
- No new features for external mode (e.g. TLS options, data migration between modes)
  unless a test shows the mode is unusable without one. Then it comes back as a question first.
- Anti-goal: docs that promise behaviour the test did not confirm.

## Approaches

1. **Manual test run on the dev suite** — cheap, exercises real Docker networking, but
   leaves nothing behind that keeps it tested.
2. **Automated integration test in CI** with a Postgres service — guards against
   regressions, but is real work and cannot catch Docker networking issues (an instance
   that cannot reach the host), which is where breakage is most likely.
3. **Manual test run plus docs** — picked. The manual run answers "does it work"; the docs
   are what other operators will actually read, and today they say almost nothing.

## Test setup

- Wipe the local dev suite and run the newest Suite: trigger the dev image build from
  `main` and use that `:dev` image.
- A separate `postgres` container, not created by the Suite, stands in for the operator's
  own server.
- One instance against the test provider only.

## Scenarios

1. Fresh install via the setup wizard, External selected, server on the `streamshare`
   network, reached by container name.
2. Server reached by host IP and published port (a server on another host or in another
   stack). This is the most likely weak spot: the Suite hands the typed host to instances
   unchanged and never joins them to a network that can reach it.
3. Empty admin password with `trust` authentication (the schema allows it for external).
4. Admin user without `CREATEDB` / `CREATEROLE`: the error must be clear.
5. Instance lifecycle: create, apply, container restart, Postgres restart, remove keeping
   data, remove dropping data.
6. Switching an existing install from managed to external: record what happens to the data
   and to the old managed container, for the docs. Not a goal to make it seamless.

## Output

- A short test report on the PR: each scenario as passed / failed with the error.
- Bug fixes as separate PRs.
- The docs section: network reachability, the privileges the admin user needs, password
  optional with trust auth, switching modes does not move data.

## Left to the builder

- Exact Postgres version for the stand-in server (default to the schema's
  `postgres:14-alpine` plus one newer major).
- How to script each scenario (API vs UI).
