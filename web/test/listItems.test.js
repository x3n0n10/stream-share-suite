import { test } from "node:test";
import assert from "node:assert/strict";
import { parseItems, normalizeItem, addItems, removeItem, joinItems } from "../src/lib/listItems.js";

test("parseItems trims, drops empties and duplicates, keeps order", () => {
  assert.deepEqual(parseItems(" a, b,,a ,c "), ["a", "b", "c"]);
  assert.deepEqual(parseItems(""), []);
  assert.deepEqual(parseItems(undefined), []);
});

test("normalizeItem filters by itemType", () => {
  assert.equal(normalizeItem(" host ", "text"), "host");
  assert.equal(normalizeItem("   ", "text"), null);
  assert.equal(normalizeItem("456", "number"), "456");
  assert.equal(normalizeItem("45a", "number"), null);
  assert.equal(normalizeItem("04:00", "time"), "04:00");
  assert.equal(normalizeItem("4:00", "time"), null);
  assert.equal(normalizeItem("24:00", "time"), null);
  assert.equal(normalizeItem("12:60", "time"), null);
});

test("addItems appends in order, ignores duplicates and invalid entries", () => {
  assert.deepEqual(addItems(["b"], "a"), ["b", "a"]);
  assert.deepEqual(addItems(["a"], "a"), ["a"]);
  assert.deepEqual(addItems([], "x"), ["x"]);
  assert.deepEqual(addItems([], "1,x,2", { itemType: "number" }), ["1", "2"]);
});

test("addItems splits pasted comma lists", () => {
  assert.deepEqual(addItems(["a"], "b, c ,a"), ["a", "b", "c"]);
});

test("addItems sorts when asked", () => {
  assert.deepEqual(addItems(["16:00"], "04:00", { itemType: "time", sort: true }), ["04:00", "16:00"]);
});

test("removeItem and joinItems", () => {
  assert.deepEqual(removeItem(["a", "b"], "a"), ["b"]);
  assert.equal(joinItems(["a", "b"]), "a,b");
  assert.equal(joinItems([]), "");
});
