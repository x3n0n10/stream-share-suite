// parseCheckTimes's tolerant parsing — invalid entries are dropped rather
// than failing the whole schedule, the same way the shell script it replaces
// behaved.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCheckTimes } from "../src/watchdog/scheduler.js";

test("parses HH:MM entries into minutes since midnight", () => {
  assert.deepEqual(parseCheckTimes("04:00,16:00"), [240, 960]);
});

test("tolerates surrounding whitespace", () => {
  assert.deepEqual(parseCheckTimes(" 04:00 , 16:00 "), [240, 960]);
});

test("drops entries that don't parse as a valid HH:MM, keeping the rest", () => {
  assert.deepEqual(parseCheckTimes("04:00,not-a-time,25:00,16:99,16:00"), [240, 960]);
});

test("an empty or garbage string yields no scheduled times at all", () => {
  assert.deepEqual(parseCheckTimes(""), []);
  assert.deepEqual(parseCheckTimes("garbage"), []);
});
