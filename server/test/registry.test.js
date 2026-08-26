import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, renderEnv, toPublicFields, applyPatch } from "../src/schema/registry.js";

const SCHEMA = {
  kind: "widget",
  label: "Widget",
  fields: [
    { key: "mode", envVar: "MODE", label: "Mode", type: "select", options: ["a", "b"], default: "a", required: true },
    { key: "name", envVar: "NAME", label: "Name", required: true },
    { key: "note", envVar: "NOTE", label: "Note" },
    { key: "secretKey", envVar: "SECRET_KEY", label: "Secret", secret: true, required: true },
    { key: "aOnly", envVar: "A_ONLY", label: "A only", required: true, dependsOn: { key: "mode", equals: "a" } },
    { key: "computed", envVar: null, label: "Not an env var" },
    { key: "flag", envVar: "FLAG", label: "Flag", type: "checkbox", default: false },
  ],
};

test("validate reports every required field that is missing", () => {
  // "mode" is required but defaults to "a", so a default satisfies required —
  // it is never reported missing. "aOnly" depends on mode==="a", which the
  // default satisfies, so it IS required here.
  const errors = validate(SCHEMA, {});
  const keys = errors.map((e) => e.key).sort();
  assert.deepEqual(keys, ["aOnly", "name", "secretKey"].sort());
});

test("validate does not require a field hidden by dependsOn", () => {
  const errors = validate(SCHEMA, { mode: "b", name: "x", secretKey: "k" });
  assert.equal(errors.some((e) => e.key === "aOnly"), false);
});

test("validate does require a dependsOn field once its condition is met", () => {
  const errors = validate(SCHEMA, { mode: "a", name: "x", secretKey: "k" });
  assert.equal(errors.some((e) => e.key === "aOnly"), true);
});

test("validate rejects a select value outside its options", () => {
  const errors = validate(SCHEMA, { mode: "z", name: "x", secretKey: "k", aOnly: "1" });
  assert.ok(errors.some((e) => e.key === "mode" && /must be one of/.test(e.message)));
});

test("renderEnv applies defaults and skips fields with no envVar", () => {
  const env = renderEnv(SCHEMA, { name: "x", secretKey: "k", aOnly: "1" });
  assert.equal(env.MODE, "a"); // default applied
  assert.equal(env.NAME, "x");
  assert.equal("NOTE" in env, false); // optional, unset — omitted, not empty
  assert.equal("computed" in env, false);
});

test("renderEnv omits a field hidden by dependsOn even if a stale value is stored", () => {
  const env = renderEnv(SCHEMA, { mode: "b", name: "x", secretKey: "k", aOnly: "leftover-from-mode-a" });
  assert.equal("A_ONLY" in env, false);
});

test("renderEnv stringifies checkbox booleans", () => {
  const env = renderEnv(SCHEMA, { name: "x", secretKey: "k", aOnly: "1", flag: true });
  assert.equal(env.FLAG, "true");
});

test("toPublicFields reports only whether a secret is set, never its value", () => {
  const fields = toPublicFields(SCHEMA, { secretKey: "super-secret" });
  const secretField = fields.find((f) => f.key === "secretKey");
  assert.equal(secretField.valueSet, true);
  assert.equal("value" in secretField, false);
  assert.equal(JSON.stringify(fields).includes("super-secret"), false);
});

test("toPublicFields reports a non-secret field's resolved value, default included", () => {
  const fields = toPublicFields(SCHEMA, {});
  assert.equal(fields.find((f) => f.key === "mode").value, "a");
});

test("applyPatch: a secret field is left alone when the patch omits it", () => {
  const next = applyPatch(SCHEMA, { secretKey: "keep-me" }, { name: "renamed" });
  assert.equal(next.secretKey, "keep-me");
  assert.equal(next.name, "renamed");
});

test("applyPatch: a secret field is replaced by a non-empty string", () => {
  const next = applyPatch(SCHEMA, { secretKey: "old" }, { secretKey: "new" });
  assert.equal(next.secretKey, "new");
});

test("applyPatch: a secret field is cleared by null or empty string", () => {
  assert.equal("secretKey" in applyPatch(SCHEMA, { secretKey: "old" }, { secretKey: null }), false);
  assert.equal("secretKey" in applyPatch(SCHEMA, { secretKey: "old" }, { secretKey: "" }), false);
});

test("applyPatch: a non-secret field with an empty string replaces rather than clears", () => {
  const next = applyPatch(SCHEMA, { note: "old" }, { note: "" });
  assert.equal(next.note, "");
});

test("applyPatch drops keys that are not part of the schema", () => {
  const next = applyPatch(SCHEMA, {}, { name: "x", bogusKey: "should vanish" });
  assert.equal("bogusKey" in next, false);
});

test("applyPatch coerces a checkbox field to a real boolean", () => {
  const next = applyPatch(SCHEMA, {}, { flag: "yes" });
  assert.strictEqual(next.flag, true);
});
