import { test } from "node:test";
import assert from "node:assert/strict";
import { moveItem, fallbackChoices, lentTo } from "../src/lib/failover.js";

test("moveItem swaps neighbours and ignores out-of-range moves", () => {
  assert.deepEqual(moveItem(["a", "b", "c"], 0, 1), ["b", "a", "c"]);
  assert.deepEqual(moveItem(["a", "b"], 0, -1), ["a", "b"]);
  assert.deepEqual(moveItem(["a", "b"], 1, 1), ["a", "b"]);
});

test("fallbackChoices leaves out self, selected and unsupported; none while loading", () => {
  const instances = [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }];
  assert.deepEqual(fallbackChoices(instances, "a", ["b"], ["a", "b", "c"]).map((i) => i.key), ["c"]);
  assert.deepEqual(fallbackChoices(instances, "a", [], null), []);
});

test("lentTo reads the instance name of a failover identity", () => {
  assert.equal(lentTo("failover:Main/123"), "Main");
  assert.equal(lentTo("failover:Living room/12.ts"), "Living room");
  assert.equal(lentTo("share:abc"), null);
  assert.equal(lentTo("192.168.1.5"), null);
  assert.equal(lentTo(undefined), null);
});
