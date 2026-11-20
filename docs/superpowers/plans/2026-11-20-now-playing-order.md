# Now playing stable order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Overview "Now playing" table stays in a stable order: oldest stream first, new streams at the bottom.

**Architecture:** A pure `sortNowPlaying(rows)` in `web/src/lib/nowPlaying.js` replaces the inline `.sort` in `web/src/pages/Overview.jsx`. Tested with node's built-in test runner, the same way as `web/src/lib/shareLinks.js`.

**Tech Stack:** React (Vite), plain JS, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-20-now-playing-order-design.md`

## Global Constraints

- No stream-share (backend) changes; only the Suite web app.
- Viewer count must not affect order.
- Do not compare `started_at` as raw strings (Go's RFC3339Nano trims trailing zeros).
- Parse `started_at` once per row, not inside the comparator.

## Review Focus

- Unparseable `started_at` (e.g. `""`, garbage): `Date.parse` gives `NaN`, which breaks the sort; treat it like missing (sorts last).
- Two streams with the same `started_at` on different instances: order by `instanceId`, so they never swap between polls.
- `instanceId` may be a number or a string: compare as strings so mixed types stay deterministic.
- Input order differs every poll (Go map order): output must be identical for any permutation.
- The input array must not be mutated (it comes from polled data).

---

### Task 1: `sortNowPlaying` and use it on the Overview

**Files:**
- Create: `web/src/lib/nowPlaying.js`
- Create: `web/test/nowPlaying.test.js`
- Modify: `web/src/pages/Overview.jsx:29-33`

**Interfaces:**
- Produces: `export function sortNowPlaying(rows)` — `rows` are objects with `started_at` (ISO string, may be missing/invalid), `instanceId` (string or number), `stream_id` (string), plus any other fields. Returns a new array of the same row objects (no added fields), sorted. Does not mutate `rows`.

- [ ] **Step 1: Write the failing tests** in `web/test/nowPlaying.test.js` (import `test` from `node:test`, `assert` from `node:assert/strict`), using a local helper `row(instanceId, stream_id, started_at)` that returns `{ instanceId, stream_id, started_at }`:

```js
test("sortNowPlaying: oldest first, viewer count ignored", () => {
  const a = { ...row(1, "a", "2026-11-20T10:00:00Z"), viewer_count: 1 };
  const b = { ...row(1, "b", "2026-11-20T09:00:00Z"), viewer_count: 5 };
  assert.deepEqual(sortNowPlaying([a, b]), [b, a]);
});

test("sortNowPlaying: compares times, not strings", () => {
  // Go drops a zero fraction: as strings "…00.5Z" < "…00Z" ('.' < 'Z'), but in time 00Z is first.
  const x = row(1, "x", "2026-11-20T10:00:00.5Z");
  const y = row(1, "y", "2026-11-20T10:00:00Z");
  assert.deepEqual(sortNowPlaying([x, y]), [y, x]);
});

test("sortNowPlaying: equal times break on instanceId, then stream_id", () => {
  const t = "2026-11-20T10:00:00Z";
  const rows = [row(2, "a", t), row(1, "b", t), row(1, "a", t)];
  assert.deepEqual(sortNowPlaying(rows).map((r) => [r.instanceId, r.stream_id]), [[1, "a"], [1, "b"], [2, "a"]]);
});

test("sortNowPlaying: missing or invalid started_at goes last", () => {
  const ok = row(1, "ok", "2026-11-20T10:00:00Z");
  const none = row(1, "none", undefined);
  const bad = row(1, "bad", "not a date");
  assert.deepEqual(sortNowPlaying([none, bad, ok]).map((r) => r.stream_id), ["ok", "bad", "none"]);
});

test("sortNowPlaying: same output for any input order, input untouched", () => {
  const rows = [row(1, "a", "2026-11-20T09:00:00Z"), row(2, "b", "2026-11-20T10:00:00Z"), row(1, "c", undefined)];
  const reversed = [...rows].reverse();
  const before = [...reversed];
  assert.deepEqual(sortNowPlaying(reversed), sortNowPlaying(rows));
  assert.deepEqual(reversed, before);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npm test`
Expected: FAIL — cannot find module `../src/lib/nowPlaying.js`.

- [ ] **Step 3: Implement `sortNowPlaying(rows)` in `web/src/lib/nowPlaying.js`**

Map each row to `{ row, t }` with `t = Date.parse(started_at)`, using `Infinity` when the result is `NaN`. Sort by `t`, then `String(instanceId)`, then `stream_id`, all three compared with `<`/`>` (no subtraction, so two `Infinity` values simply tie; no `localeCompare`, so the order doesn't depend on locale). Return the rows. Add a one-line header comment saying why: instances list streams in random order, so this keeps rows in place.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npm test`
Expected: all tests PASS (the new ones and the existing ones).

- [ ] **Step 5: Use it in `web/src/pages/Overview.jsx`**

Import `sortNowPlaying` from `../lib/nowPlaying.js`. Replace `.sort((a, b) => b.viewer_count - a.viewer_count)` with a call to `sortNowPlaying(...)` around the `flatMap` result. Row keys stay as they are.

- [ ] **Step 6: Build**

Run: `cd web && npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 7: Commit** (the repo's simplify-guard hook requires /simplify on the staged diff first)

```bash
git add web/src/lib/nowPlaying.js web/test/nowPlaying.test.js web/src/pages/Overview.jsx
git commit -m "fix(overview): keep Now playing rows in a stable order"
```
