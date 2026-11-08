// Pure helpers behind the Share links page. Dates are built with the local-time
// constructor (31 October 2026 is a Saturday) so the tests hold in any timezone.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shareState,
  sortShares,
  MAX_WINDOW_MS,
  defaultWindow,
  validateWindow,
  toDatetimeLocal,
  formatWindow,
  failedPoll,
} from "../src/lib/shareLinks.js";

const oct = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute);
const nov1 = (hour, minute = 0) => new Date(2026, 10, 1, hour, minute);

function share(token, startsAt, endsAt, revokedAt = null) {
  return { token, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), revokedAt };
}

test("shareState: revoked wins over the window", () => {
  const s = share("a", oct(31, 20), oct(31, 23), "2026-10-31T10:00:00Z");
  assert.equal(shareState(s, oct(31, 21)), "revoked");
});

test("shareState: the window is [startsAt, endsAt)", () => {
  const s = share("a", oct(31, 20), oct(31, 23));
  assert.equal(shareState(s, oct(31, 19, 59)), "scheduled");
  assert.equal(shareState(s, oct(31, 20)), "active");
  assert.equal(shareState(s, oct(31, 22, 59)), "active");
  assert.equal(shareState(s, oct(31, 23)), "ended");
});

test("shareState accepts epoch milliseconds as well as a Date", () => {
  const s = share("a", oct(31, 20), oct(31, 23));
  assert.equal(shareState(s, oct(31, 21).getTime()), "active");
});

test("sortShares: active, then scheduled by start, then ended and revoked newest end first", () => {
  const now = oct(31, 21);
  const input = [
    share("endedOld", oct(31, 10), oct(31, 12)),
    share("later", nov1(10), nov1(12)),
    share("active", oct(31, 20), oct(31, 23)),
    share("endedNew", oct(31, 16), oct(31, 18)),
    share("soon", oct(31, 22), oct(31, 23, 30)),
    share("revoked", oct(31, 19), oct(31, 23), "2026-10-31T20:30:00Z"),
  ];
  const before = input.map((s) => s.token);

  const sorted = sortShares(input, now).map((s) => s.token);

  assert.deepEqual(sorted, ["active", "soon", "later", "revoked", "endedNew", "endedOld"]);
  assert.deepEqual(
    input.map((s) => s.token),
    before,
    "the input must not be mutated"
  );
});

test("validateWindow rejects each bad window with its message", () => {
  const now = oct(31, 13);
  assert.equal(validateWindow(new Date("nope"), oct(31, 23), now), "Pick a start and an end time.");
  assert.equal(validateWindow(oct(31, 20), new Date("nope"), now), "Pick a start and an end time.");
  assert.equal(validateWindow(oct(31, 20), oct(31, 20), now), "The end must be after the start.");
  assert.equal(validateWindow(oct(31, 20), oct(31, 19), now), "The end must be after the start.");
  const start = oct(31, 20);
  assert.equal(
    validateWindow(start, new Date(start.getTime() + MAX_WINDOW_MS + 1), now),
    "A share link may last at most 24 hours."
  );
  assert.equal(validateWindow(oct(31, 10), oct(31, 12), now), "The window is already over.");
});

test("validateWindow accepts exactly 24 hours and an ordinary window", () => {
  const now = oct(31, 13);
  const start = oct(31, 14);
  assert.equal(validateWindow(start, new Date(start.getTime() + MAX_WINDOW_MS), now), null);
  assert.equal(validateWindow(oct(31, 20), oct(31, 23), now), null);
});

test("MAX_WINDOW_MS is 24 hours", () => {
  assert.equal(MAX_WINDOW_MS, 24 * 60 * 60 * 1000);
});

test("defaultWindow starts now and lasts two hours", () => {
  const now = oct(31, 20);
  const w = defaultWindow(now);
  assert.equal(w.startsAt.getTime(), now.getTime());
  assert.equal(w.endsAt.getTime() - w.startsAt.getTime(), 2 * 60 * 60 * 1000);
});

test("toDatetimeLocal formats local time for a datetime-local input", () => {
  assert.equal(toDatetimeLocal(oct(31, 9, 5)), "2026-10-31T09:05");
});

test("formatWindow shows weekday and local times, naming the end day when it differs", () => {
  assert.equal(formatWindow(oct(31, 20), oct(31, 23)), "Sat 20:00 to 23:00");
  assert.equal(formatWindow(oct(31, 22), nov1(1)), "Sat 22:00 to Sun 01:00");
});

test("failedPoll keeps the last good rows of the same instance and carries the error", () => {
  const lastGood = { instanceId: "a", shares: [{ token: "tok" }], publicBaseUrl: "https://tv.example.com" };
  const data = failedPoll("a", "provider unreachable", lastGood);
  assert.equal(data.instanceId, "a");
  assert.equal(data.error, "provider unreachable");
  assert.deepEqual(data.shares, [{ token: "tok" }]);
  assert.equal(data.publicBaseUrl, "https://tv.example.com");
});

test("failedPoll with no good poll yet is an empty, instance-scoped error", () => {
  const data = failedPoll("b", "timed out", null);
  assert.deepEqual(data, { instanceId: "b", shares: [], publicBaseUrl: null, error: "timed out" });
});

test("failedPoll never reuses another instance's rows", () => {
  const otherInstance = { instanceId: "a", shares: [{ token: "tok" }], publicBaseUrl: "https://tv.example.com" };
  const data = failedPoll("b", "timed out", otherInstance);
  assert.equal(data.instanceId, "b");
  assert.deepEqual(data.shares, []);
  assert.equal(data.publicBaseUrl, null);
});
