# Fallback Viewings As One Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A viewing that borrows another instance's connection shows as one marked row in Now playing and History, counts once in the badge, and adds no "Through X" rows or double counts to the Leaderboard.

**Architecture:** The Suite server drops lent viewers (`failover:` usernames) once, in `server/src/routes/ops.js`, before any page sees the data. The pages only render the amber marking. stream-share leaves lent viewers out of its aggregated stats, the one thing the Suite cannot subtract.

**Tech Stack:** Suite: Node (Express, `node:test`), React + Tailwind 3. stream-share: Go, Postgres.

**Spec:** `docs/superpowers/specs/2026-11-20-fallback-display-design.md`

## Global Constraints

- The repos are public: no provider, instance or channel names, URLs, credentials or IPs from the owner's setup in code, tests, docs, commits or PR text. Use "Main", "Spare", "Alpha 1" and the like.
- A lent viewer is any username / viewer id starting with `failover:` (the same test as upstream `session.IsFailoverIdentity`).
- Marking copy: Now playing `Using <via>'s connection`; History `Used <via>'s connection`. Never give a reason ("at its limit").
- Amber tones already in the Suite: text `text-amber-600 dark:text-amber-400`, edge `border-amber-500`.
- Instance cards are untouched (they read `stats` / `streams_count`, not `summary`).
- Suite work goes on branch `feat/fallback-display` (PR #69). stream-share work goes on a new branch `feat/stats-skip-lent-viewers` from `origin/master`, with its own draft PR. The owner merges.
- Commits end with the session's `Co-Authored-By` trailer. The repo's simplify guard requires `/simplify` on the staged diff before each commit.

## Review Focus

1. Older instances report viewers as plain strings, newer as `{id, display_name}`: both must be recognised as lent (Task 1 test).
2. A stream with no viewers right now (`viewers: []`, e.g. a viewer reconnecting) is not "all lent" and must stay (Task 1 test).
3. An older instance without a `viewers` list or without `summary` keeps working: stream kept as is, badge falls back to `streams_count` (Task 1 tests).
4. History must not come up short: with more real rows than `limit`, lent rows are dropped before the cut, so the feed still has `limit` rows (Task 2 test).
5. Top viewers stays full: a lent user with the most watch time must not push a real user out of the top 10 (Task 2 test).

---

### Task 1: Lent-viewer filter for Now playing and the badge

**Files:**
- Modify: `server/src/reconcile/failover.js` (add two exports at the end)
- Modify: `server/src/routes/ops.js` (`/overview`, `/active-streams`)
- Test: `server/test/failover-display.test.js` (create), `server/test/ops-active-streams.test.js` (extend)

**Interfaces:**
- Produces: `isLentViewer(id: string): boolean` and `withoutLentViewers(summary: Stream[]): Stream[]` from `server/src/reconcile/failover.js`. A `Stream` is one `status.summary` entry; `viewers` items are strings or `{ id, display_name }`.

- [ ] **Step 1: Write the failing unit tests** in `server/test/failover-display.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { isLentViewer, withoutLentViewers } from "../src/reconcile/failover.js";

test("isLentViewer matches failover: identities only", () => {
  assert.equal(isLentViewer("failover:Main/3"), true);
  assert.equal(isLentViewer("alice"), false);
  assert.equal(isLentViewer("10.0.0.5"), false);
  assert.equal(isLentViewer(undefined), false);
});

test("withoutLentViewers drops lent-only streams, keeps mixed and empty ones", () => {
  const summary = [
    { stream_id: "1", viewer_count: 1, viewers: ["failover:Main/1"] },
    { stream_id: "2", viewer_count: 1, viewers: [{ id: "failover:Main/2", display_name: "x" }] },
    { stream_id: "3", viewer_count: 2, viewers: ["bob", { id: "failover:Main/4" }] },
    { stream_id: "4", viewer_count: 0, viewers: [] },
    { stream_id: "5", viewer_count: 1 },
    { stream_id: "6", viewer_count: 1, viewers: ["carol"], via: "Spare" },
  ];
  assert.deepEqual(withoutLentViewers(summary), [
    { stream_id: "3", viewer_count: 1, viewers: ["bob"] },
    { stream_id: "4", viewer_count: 0, viewers: [] },
    { stream_id: "5", viewer_count: 1 },
    { stream_id: "6", viewer_count: 1, viewers: ["carol"], via: "Spare" },
  ]);
  assert.deepEqual(withoutLentViewers(undefined), []);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd server && node --test test/failover-display.test.js`
Expected: FAIL, `isLentViewer` is not exported.

- [ ] **Step 3: Implement both in `server/src/reconcile/failover.js`**

`isLentViewer` is `String(id ?? "").startsWith("failover:")`, with a one-line comment that it mirrors stream-share's `session.FailoverIdentityPrefix`. `withoutLentViewers` returns `[]` for a non-array. A stream without a `viewers` array passes through unchanged. Otherwise it keeps the stream only if it had no viewers or kept at least one, and sets `viewer_count` to the kept length only when something was removed.

- [ ] **Step 4: Run them and see them pass**

Run: `cd server && node --test test/failover-display.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing route tests** in `server/test/ops-active-streams.test.js`.

Change `addInstance` to `addInstance(name, { status = 200, ...data } = {})`, answering every path with `{ success: status === 200, data }`. Existing calls pass `{ streams_count: n }` instead of `{ streams: n }`. Add:

```js
test("a stream whose only viewers are lent is not counted", async () => {
  const c = await signedInClient(base);
  await addInstance("Main", { streams_count: 1, summary: [{ stream_id: "1", viewers: ["alice"], via: "Spare" }] });
  await addInstance("Spare", { streams_count: 2, summary: [
    { stream_id: "9", viewers: ["failover:Main/1"] },
    { stream_id: "8", viewers: ["bob", "failover:Main/2"] },
  ] });
  assert.deepEqual((await c.get("/api/active-streams")).body, { activeStreams: 2 });
});

test("overview leaves lent-only streams out of each instance's summary", async () => {
  const c = await signedInClient(base);
  await addInstance("Spare", { streams_count: 1, summary: [{ stream_id: "9", viewers: ["failover:Main/1"] }] });
  const res = await c.get("/api/overview");
  assert.deepEqual(res.body.instances[0].status.summary, []);
  assert.equal(res.body.instances[0].status.streams_count, 1); // cards keep the instance's own count
});
```

The existing tests (no `summary`) must keep passing through the `streams_count` fallback. The stand-in answers every path with the same body; that is enough for `/overview`. Task 2 reuses this harness.

- [ ] **Step 6: Run and see the new tests fail**

Run: `cd server && node --test test/ops-active-streams.test.js`
Expected: the two new tests FAIL (counts 3, summary not filtered).

- [ ] **Step 7: Use the filter in `server/src/routes/ops.js`**

- `/overview`: after `Promise.all`, replace each snapshot whose `status` is set with `{ ...s, status: { ...s.status, summary: withoutLentViewers(s.status.summary) } }`, but only when `s.status.summary` is an array.
- `/active-streams`: per fulfilled result, count `withoutLentViewers(summary).length` when `r.value?.summary` is an array, else `Number(r.value?.streams_count) || 0`. Update the route comment.

- [ ] **Step 8: Run the server suite**

Run: `cd server && node --test "test/*.test.js"`
Expected: all pass.

- [ ] **Step 9: Commit** `feat(failover): leave lent viewers out of Now playing and the badge`

---

### Task 2: History and Top viewers without lent rows

**Files:**
- Modify: `server/src/routes/ops.js` (`/history`, `/leaderboard`)
- Test: `server/test/ops-active-streams.test.js` (extend, using the `addInstance(name, data)` harness from Task 1; update the file's header comment to cover History and the Leaderboard too)

**Interfaces:**
- Consumes: `isLentViewer(id)` from Task 1.

- [ ] **Step 1: Write the failing tests**

```js
test("history drops lent rows before cutting to limit", async () => {
  const c = await signedInClient(base);
  const t = (m) => new Date(Date.UTC(2026, 0, 1, 12, m)).toISOString();
  await addInstance("Main", { feed: [
    { username: "alice", start_time: t(3), via: "Spare" },
    { username: "bob", start_time: t(1) },
  ] });
  await addInstance("Spare", { feed: [{ username: "failover:Main/1", start_time: t(4) }] });
  const res = await c.get("/api/history?limit=2");
  assert.deepEqual(res.body.feed.map((e) => e.username), ["alice", "bob"]);
});

test("top viewers leave lent users out before the top-10 cut", async () => {
  const c = await signedInClient(base);
  const users = Array.from({ length: 10 }, (_, i) => ({ username: `u${i}`, sessions: 1, watch_seconds: 100 + i }));
  await addInstance("Main", { top_titles: [], top_users: users });
  await addInstance("Spare", { top_titles: [], top_users: [{ username: "failover:Main/1", sessions: 5, watch_seconds: 9999 }] });
  const res = await c.get("/api/leaderboard");
  assert.equal(res.body.top_users.length, 10);
  assert.ok(res.body.top_users.every((u) => !u.username.startsWith("failover:")));
});
```

- [ ] **Step 2: Run and see them fail**

Run: `cd server && node --test test/ops-active-streams.test.js`
Expected: both FAIL (lent rows present).

- [ ] **Step 3: Filter in `server/src/routes/ops.js`**

In `/history`, skip `item` when `isLentViewer(item.username)` inside the `collect` loop. In `/leaderboard`, skip `u` when `isLentViewer(u.username)` in the `top_users` loop. `top_titles` is unchanged.

- [ ] **Step 4: Run the server suite**

Run: `cd server && node --test "test/*.test.js"`
Expected: all pass.

- [ ] **Step 5: Commit** `feat(failover): leave lent viewers out of History and Top viewers`

---

### Task 3: Amber marking in the pages; Through labels gone

**Files:**
- Modify: `web/src/pages/Overview.jsx`, `web/src/pages/History.jsx`, `web/src/pages/Leaderboard.jsx`
- Modify: `web/src/lib/failover.js` (remove `lentTo`), `web/test/failover.test.js` (remove its test and import)
- Modify: `docs/instances.md` (Failover bullet)

**Interfaces:**
- Produces: no shared code. Both pages inline the amber line as `<p className="text-xs text-amber-600 dark:text-amber-400">`, the same pattern as `web/src/components/Subscription.jsx:187`.

- [ ] **Step 1: Remove `lentTo`** from `web/src/lib/failover.js` and its test from `web/test/failover.test.js`. Update the file's header comment ("Pure logic behind FallbackPicker").

- [ ] **Step 2: Overview.** Remove the `lentTo` import. `viewerLabel` returns `typeof v === "string" ? v : v.display_name || v.id`. `isAliasable` drops its `lentTo` check. In Now playing rows, remove the grey `via` span. When `s.via` is set, give the title `<td>` `border-l-[3px] border-amber-500` and render the amber line `Using {s.via}'s connection` directly under the title `<p>`, above `TechSummary`.

- [ ] **Step 3: History.** Remove the `lentTo` import and both `lentTo` branches in the User cell (it shows `e.display_name || e.username` again). Remove the grey `via` span. When `e.via` is set, give the row's first `<td>` `border-l-[3px] border-amber-500` and render the amber line `Used {e.via}'s connection` under the title text in the Title cell. Add `e.via?.toLowerCase().includes(q)` to the search filter.

- [ ] **Step 4: Leaderboard.** Remove the `lentTo` import; `primary={u.username}`.

- [ ] **Step 5: Docs.** In `docs/instances.md`, append to the Failover bullet: "A viewing that uses a fallback's connection shows once, on the instance the viewer watches, marked "Using <fallback>'s connection"; the fallback's own copy is not listed."

- [ ] **Step 6: Verify**

Run: `cd web && node --test "test/*.test.js" && npm run build`
Expected: tests pass, build succeeds, and `grep -rn "lentTo\|Through " web/src` finds nothing.

- [ ] **Step 7: Look at it.** Run the Suite against stand-ins or the local dev suite (see the run skill). Screenshot Now playing with one `via` row, in light and dark. Expected: amber edge and amber line under the title; no other row changed.

- [ ] **Step 8: Commit** `feat(failover): mark borrowed viewings in Now playing and History`

---

### Task 4: stream-share stats skip lent viewers

**Files** (stream-share, branch `feat/stats-skip-lent-viewers` from `origin/master`):
- Modify: `pkg/database/stream_history.go` (`GetWatchStats`, `GetTopTitles`, `GetTopUsers`)
- Test: `pkg/database/stream_history_pg_test.go`

**Interfaces:**
- Produces: unchanged signatures; rows with `username LIKE 'failover:%'` no longer count.

- [ ] **Step 1: Write the failing test** `TestStatsSkipLentViewers`:

```go
func TestStatsSkipLentViewers(t *testing.T) {
	m := freshHistoryDB(t)
	_, _ = m.AddStreamHistory("alice", "10", "live", "Alpha 1", "", "")
	_, _ = m.AddStreamHistory("failover:Main/1", "20", "live", "Alpha 1 UHD", "", "")
	w, err := m.GetWatchStats(time.Time{})
	if err != nil || w.Sessions != 1 || w.UniqueViewers != 1 {
		t.Fatalf("watch stats = %+v (%v)", w, err)
	}
	titles, err := m.GetTopTitles(time.Time{}, 10)
	if err != nil || len(titles) != 1 || titles[0].StreamID != "10" {
		t.Fatalf("top titles = %+v (%v)", titles, err)
	}
	users, err := m.GetTopUsers(time.Time{}, 10)
	if err != nil || len(users) != 1 || users[0].Username != "alice" {
		t.Fatalf("top users = %+v (%v)", users, err)
	}
}
```

- [ ] **Step 2: Start a throwaway Postgres and run the test to see it fail**

```bash
D=$(mktemp -d) && initdb -D $D -U postgres -A trust >/dev/null && pg_ctl -D $D -o "-p 55432 -k $D" -l $D/log start
export SS_TEST_DSN="postgres://postgres@127.0.0.1:55432/postgres?sslmode=disable"
go test ./pkg/database/ -run TestStatsSkipLentViewers -count=1
```
Expected: FAIL (2 sessions, 2 titles, 2 users). Check how `testDB` reads `SS_TEST_DSN` first, and whether it needs the schema created (follow `stream_names_pg_test.go`).

- [ ] **Step 3: Add the filter**

Add `const failoverUsernamePrefix = "failover:"` in `stream_history.go`, with a comment that it mirrors `session.FailoverIdentityPrefix` (database cannot import session, since session imports database). In all three queries, add `AND username NOT LIKE $N` with the parameter `failoverUsernamePrefix + "%"`.

- [ ] **Step 4: Run the database tests**

Run: `go test ./pkg/database/ -count=1` (with `SS_TEST_DSN` still set)
Expected: PASS, including the existing `TestSetStreamHistoryVia`.

- [ ] **Step 5: Lint**

Run: `docker run --rm -v "$PWD":/app -w /app -e GOFLAGS=-mod=vendor golangci/golangci-lint:latest golangci-lint run ./...`
Expected: no issues. Then stop Postgres with `pg_ctl -D $D stop`.

- [ ] **Step 6: Commit, push, and open a draft PR** `feat(stats): leave lent failover viewers out of the top lists`. Link Suite PR #69 in the body.
