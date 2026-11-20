# Live Connection Meter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The connection caption and meter on instance blocks add up: "here" counts only this instance's own provider connections, and nothing shows less use than the live count.

**Architecture:** stream-share stops counting fallback-served streams in `local_upstream_connections`. The Suite derives "in use" as the higher of the provider total and the live count, in one helper used by the caption, the meter and the Instances detail.

**Tech Stack:** stream-share: Go. Suite: React + Tailwind 3, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-20-live-connection-meter-design.md`

## Global Constraints

- The repos are public: no provider, instance or channel names, URLs, credentials or IPs from the owner's setup anywhere pushed. Use "Main", "Spare" and the like.
- In use = `max(active_connections ?? 0, local_upstream_connections ?? 0)`.
- Caption copy: `${used} of ${max} connections in use · ${here} here` (and the existing no-limit and no-"here" variants).
- No extra provider reads; the refresh interval is unchanged.
- Commits end with the session's `Co-Authored-By` trailer. Both repos have a simplify-guard hook on `git commit`.
- stream-share: Go via go.mod's toolchain, always `-mod=vendor`; golangci-lint (errcheck) and `gofmt -l pkg/` clean before pushing.

## Review Focus

1. A provider total of 0 with live streams (the reported case): caption and meter show the live count, not 0 (Task 2 test).
2. Older instances without `local_upstream_connections`: behave as before (Task 2 test).
3. A provider with no connection limit (`max_connections` absent): caption says "N connections in use", no meter, and N follows the same rule (Task 2 test).
4. Use above the limit (provider total 2, limit 1): severity stays rose, and the meter is full (unchanged behaviour, covered by the rule test feeding `used`).
5. A lent stream on the lender (no `via`) still counts as "here" there (Task 1 test).

---

### Task 1: stream-share counts only own-provider streams as "here"

**Files** (stream-share, new branch `fix/local-connections-skip-via` from `origin/master`, in its own worktree):
- Modify: `pkg/server/handlers_provider.go` (`activeStreamCount`)
- Test: `pkg/server/handlers_provider_test.go`

**Interfaces:**
- Produces: `countOwnStreams(streams []*types.StreamSession) int` in `handlers_provider.go`; `activeStreamCount()` returns `countOwnStreams(c.sessionManager.GetAllStreams())` (keeping its nil-manager guard).

- [ ] **Step 1: Write the failing test** `TestCountOwnStreamsSkipsFallbackServed`:

```go
func TestCountOwnStreamsSkipsFallbackServed(t *testing.T) {
	own := &types.StreamSession{StreamID: "1", Active: true}
	lentHere := &types.StreamSession{StreamID: "2", Active: true} // a lent stream on the lender has no via
	borrowed := &types.StreamSession{StreamID: "3", Active: true}
	borrowed.SetVia("Spare")
	if got := countOwnStreams([]*types.StreamSession{own, lentHere, borrowed}); got != 2 {
		t.Fatalf("countOwnStreams = %d, want 2", got)
	}
	if got := countOwnStreams(nil); got != 0 {
		t.Fatalf("countOwnStreams(nil) = %d, want 0", got)
	}
}
```

- [ ] **Step 2: Run and see it fail**

Run: `go test -mod=vendor ./pkg/server/ -run TestCountOwnStreamsSkipsFallbackServed -count=1`
Expected: FAIL to compile (`countOwnStreams` undefined).

- [ ] **Step 3: Implement** `countOwnStreams`: count streams that are `Active` and whose `GetVia()` is empty. Rewire `activeStreamCount` to it, and extend the comment above `data["local_upstream_connections"]` to say a stream served through a fallback uses that instance's connection, so it is not counted here.

- [ ] **Step 4: Verify**

Run: `go test -mod=vendor ./pkg/... && gofmt -l pkg/` and the golangci-lint Docker command (`docker run --rm -v "$PWD":/app -w /app -e GOFLAGS=-mod=vendor golangci/golangci-lint:latest golangci-lint run ./...`).
Expected: all pass, gofmt prints nothing, lint 0 issues.

- [ ] **Step 5: Commit** `fix(provider): leave fallback-served streams out of local connections`. The controller pushes and opens the PR after review.

---

### Task 2: Suite meter uses the higher of provider total and live count

**Files** (Suite, branch `feat/live-connection-meter`, PR #71):
- Create: `web/src/lib/connections.js`
- Modify: `web/src/components/Subscription.jsx` (`connectionsText`, `ConnectionMeter`, `SubscriptionDetail`'s Connections fact)
- Test: `web/test/connections.test.js` (create)

**Interfaces:**
- Produces: `connectionUsage(provider) -> { used: number, here: number | null, max: number | undefined }` from `web/src/lib/connections.js`. `used` is the rule from Global Constraints; `here` is `max(0, local_upstream_connections)` when it is a number, else `null` (it never exceeds `used`, by the rule); `max` is `provider.max_connections`. The helper lives in `web/src/lib/` rather than `Subscription.jsx` (the spec's suggestion) because the `node --test` web tests import plain `.js` modules only.

- [ ] **Step 1: Write the failing tests** in `web/test/connections.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { connectionUsage } from "../src/lib/connections.js";

test("live count wins over a stale provider total", () => {
  assert.deepEqual(connectionUsage({ active_connections: 0, local_upstream_connections: 2, max_connections: 1 }), { used: 2, here: 2, max: 1 });
});

test("provider total wins when other devices use the account", () => {
  assert.deepEqual(connectionUsage({ active_connections: 3, local_upstream_connections: 1, max_connections: 4 }), { used: 3, here: 1, max: 4 });
});

test("older instances without a live count, and no limit", () => {
  assert.deepEqual(connectionUsage({ active_connections: 1 }), { used: 1, here: null, max: undefined });
  assert.deepEqual(connectionUsage({}), { used: 0, here: null, max: undefined });
});
```

- [ ] **Step 2: Run and see them fail**

Run: `cd web && node --test test/connections.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `connectionUsage`** in `web/src/lib/connections.js` (negative inputs count as 0).

- [ ] **Step 4: Use it in `Subscription.jsx`**
- `connectionsText`: `used` and `here` from the helper. The text format is otherwise unchanged ("· N here" only when `here` is not null).
- `ConnectionMeter`: `used`/`here` from the helper (`here ?? 0` for the strong segment); `elsewhere = used - here`; severity and `aria-valuenow` follow `used`.
- `SubscriptionDetail` Connections fact: value "`used` of `max`" (or `used` alone without a limit); sub "`here` from this instance" when `here` is not null.

- [ ] **Step 5: Verify**

Run: `cd web && node --test "test/*.test.js" && npm run build`
Expected: all pass, build succeeds, and `grep -n "active_connections" web/src/components/Subscription.jsx` finds no direct use left outside the helper.

- [ ] **Step 6: Commit** `feat(overview): connection meter trusts the live count`.
