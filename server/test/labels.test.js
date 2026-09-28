import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { managedLabels, belongsToAnotherSuite, LABEL_SUITE } from "../src/docker/labels.js";

const original = process.env.SUITE_CONTAINER_PREFIX;

beforeEach(() => {
  delete process.env.SUITE_CONTAINER_PREFIX;
});

after(() => {
  if (original === undefined) delete process.env.SUITE_CONTAINER_PREFIX;
  else process.env.SUITE_CONTAINER_PREFIX = original;
});

test("managedLabels carries this Suite's prefix as its instance label", () => {
  assert.equal(managedLabels("gluetun", "h")[LABEL_SUITE], "streamshare-suite-");

  process.env.SUITE_CONTAINER_PREFIX = "dev-";
  assert.equal(managedLabels("gluetun", "h")[LABEL_SUITE], "dev-");
});

test("a container labeled for this Suite does not belong to another", () => {
  assert.equal(belongsToAnotherSuite(managedLabels("gluetun", "h")), false);
});

test("a container labeled for a different prefix belongs to another Suite", () => {
  process.env.SUITE_CONTAINER_PREFIX = "dev-";
  const stable = { ...managedLabels("gluetun", "h"), [LABEL_SUITE]: "streamshare-suite-" };
  assert.equal(belongsToAnotherSuite(stable), true);
});

test("a legacy managed container with no instance label is treated as this Suite's own", () => {
  const legacy = managedLabels("gluetun", "h");
  delete legacy[LABEL_SUITE];
  assert.equal(belongsToAnotherSuite(legacy), false);
});

test("an unmanaged container never belongs to another Suite, even with the label present", () => {
  assert.equal(belongsToAnotherSuite({}), false);
  assert.equal(belongsToAnotherSuite(undefined), false);
  assert.equal(belongsToAnotherSuite({ [LABEL_SUITE]: "other-" }), false);
});
