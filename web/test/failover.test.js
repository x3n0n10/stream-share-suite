import { test } from "node:test";
import assert from "node:assert/strict";
import { moveItem, fallbackChoices, unsupportedReason, needsRecheck, lentTo } from "../src/lib/failover.js";

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

test("lentTo reads the instance name of a failover identity", () => {
  assert.equal(lentTo("failover:Main/123"), "Main");
  assert.equal(lentTo("failover:Living room/12.ts"), "Living room");
  assert.equal(lentTo("share:abc"), null);
  assert.equal(lentTo("192.168.1.5"), null);
  assert.equal(lentTo(undefined), null);
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
