import { test } from "node:test";
import assert from "node:assert/strict";
import { moveItem, fallbackChoices, unsupportedReason, needsRecheck } from "../src/lib/failover.js";

test("moveItem swaps neighbours and ignores out-of-range moves", () => {
  assert.deepEqual(moveItem(["a", "b", "c"], 0, 1), ["b", "a", "c"]);
  assert.deepEqual(moveItem(["a", "b"], 0, -1), ["a", "b"]);
  assert.deepEqual(moveItem(["a", "b"], 1, 1), ["a", "b"]);
});

test("fallbackChoices leaves out self and selected, says why the rest cannot be picked; none while loading", () => {
  const instances = [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }, { key: "e" }];
  const support = { supported: ["a", "b", "c"], unreachable: ["e"] };
  assert.deepEqual(
    fallbackChoices(instances, "a", ["b"], support).map((i) => [i.key, i.reason]),
    [["c", null], ["d", "needs a newer StreamShare version"], ["e", "not running yet"]]
  );
  assert.deepEqual(fallbackChoices(instances, "a", [], null), []);
});

test("unsupportedReason is null while support is loading", () => {
  assert.equal(unsupportedReason("a", null), null);
});

test("needsRecheck while loading or while another instance cannot be picked", () => {
  const instances = [{ key: "a" }, { key: "b" }];
  assert.equal(needsRecheck(instances, "a", null), true);
  assert.equal(needsRecheck([], "a", null), false);
  assert.equal(needsRecheck(instances, "a", { supported: ["b"], unreachable: [] }), false);
  assert.equal(needsRecheck(instances, "a", { supported: [], unreachable: ["b"] }), true);
  assert.equal(needsRecheck(instances, "a", { supported: [], unreachable: [] }), true);
  assert.equal(needsRecheck(instances, "b", { supported: ["b"], unreachable: [] }), true);
  assert.equal(needsRecheck([{ key: "a" }], "a", { supported: [], unreachable: ["a"] }), false);
});
