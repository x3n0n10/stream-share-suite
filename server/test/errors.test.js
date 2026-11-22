import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SuiteError, sendError } from "../src/errors.js";
import { validatePassword } from "../src/auth/passwords.js";
import { validate } from "../src/schema/registry.js";

function fakeRes() {
  return {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("sendError sends code and params for a SuiteError", () => {
  const res = sendError(fakeRes(), 400, new SuiteError("password_too_short", "Password must be at least 12 characters.", { min: 12 }));
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, {
    error: "Password must be at least 12 characters.",
    code: "password_too_short",
    params: { min: 12 },
  });
});

test("sendError leaves out code for an outside error", () => {
  const res = sendError(fakeRes(), 502, new Error("ECONNREFUSED"));
  assert.deepEqual(res.body, { error: "ECONNREFUSED" });
  assert.ok(!("code" in res.body));
});

test("sendError merges extra", () => {
  const res = sendError(fakeRes(), 200, new Error("boom"), { ok: false });
  assert.deepEqual(res.body, { error: "boom", ok: false });
});

test("validatePassword returns codes", () => {
  assert.equal(validatePassword("short").code, "password_too_short");
  assert.equal(validatePassword("x".repeat(201)).code, "password_too_long");
  assert.equal(validatePassword("x".repeat(12)), null);
});

test("registry.validate tags errors with codes", () => {
  const schema = {
    fields: [
      { key: "displayName", label: "Name", required: true },
      { key: "mode", label: "Mode", type: "select", options: ["a", "b"] },
      { key: "slug", label: "Slug", pattern: /^[a-z]+$/, patternMessage: "Letters only." },
      { key: "blob", label: "Blob", json: true },
    ],
  };
  const errors = validate(schema, { mode: "c", slug: "X1", blob: "{" });
  assert.deepEqual(errors, [
    { key: "displayName", code: "required", message: "Name is required." },
    { key: "mode", code: "not_one_of", message: "Mode must be one of: a, b.", params: { options: "a, b" } },
    { key: "slug", code: "pattern", message: "Letters only." },
    { key: "blob", code: "invalid_json", message: "Blob must be valid JSON." },
  ]);
  const plain = validate({ fields: [{ key: "s", label: "S", pattern: /^a$/ }] }, { s: "b" });
  assert.deepEqual(plain, [{ key: "s", code: "invalid", message: "S is not valid." }]);
});

test("no route sends a raw error body", () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src");
  const hits = [];
  (function scan(dir) {
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) scan(file);
      else if (name.endsWith(".js") && name !== "errors.js" && /\.json\(\{\s*(ok:\s*false,\s*)?(error\s*:|errors\b)/.test(readFileSync(file, "utf8"))) hits.push(file);
    }
  })(root);
  assert.deepEqual(hits, []);
});
