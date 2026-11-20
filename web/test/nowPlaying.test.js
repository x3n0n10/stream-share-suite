// Ordering of the Overview's "Now playing" rows.

import { test } from "node:test";
import assert from "node:assert/strict";
import { sortNowPlaying } from "../src/lib/nowPlaying.js";

const row = (instanceId, stream_id, started_at) => ({ instanceId, stream_id, started_at });

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
