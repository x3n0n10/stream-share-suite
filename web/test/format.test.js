import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDuration, formatList, formatRelativeTime } from "../src/lib/format.js";

test("formatDuration is localized", (t) => {
  assert.match(formatDuration(3900, "en"), /^1\s?h,? 5\s?m/);
  if (typeof Intl.DurationFormat !== "function") return t.skip("no Intl.DurationFormat");
  assert.notEqual(formatDuration(3900, "de"), formatDuration(3900, "en"));
});

test("formatRelativeTime uses the given language", () => {
  const threeDaysAgo = new Date(Date.now() - 3 * 86400 * 1000).toISOString();
  assert.match(formatRelativeTime(threeDaysAgo, { lng: "en" }), /3 days/);
  assert.match(formatRelativeTime(threeDaysAgo, { lng: "nl" }), /3 dagen/);
});

test("formatRelativeTime handles missing values", () => {
  assert.equal(formatRelativeTime(null), "—");
});

test("formatRelativeTime under a minute is localized", () => {
  assert.equal(formatRelativeTime(new Date().toISOString(), { lng: "nl" }), "nu");
  assert.equal(formatRelativeTime(new Date().toISOString(), { lng: "en" }), "now");
});

test("formatList joins with a localized conjunction", () => {
  assert.equal(formatList(["a", "b", "c"], "en"), "a, b, and c");
});
