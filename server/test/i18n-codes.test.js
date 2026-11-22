import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Every code literal the server sends must have an English key, or the web
// app silently falls back to the server's English in every other language.

const en = JSON.parse(
  readFileSync(new URL("../../web/src/locales/en/translation.json", import.meta.url), "utf8")
);
const SRC = new URL("../src/", import.meta.url).pathname;

const has = (key) => {
  const parts = key.split(".");
  const last = parts.pop();
  const ns = parts.reduce((o, p) => o?.[p], en);
  return [last, `${last}_one`, `${last}_other`].some((k) => ns && k in ns);
};

function* files(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (p.endsWith(".js")) yield p;
  }
}

// Namespace comes from the call shape: SuiteError(...) is errors, a code in a
// reasonI18n / warningsI18n is plan.*, an item with a `key:` just before it is
// a validation error, and any other `code: "x"` is a job log line.
function namespaceFor(text, index) {
  const before = text.slice(Math.max(0, index - 80), index);
  if (/reasonI18n:\s*\{\s*$/.test(before)) return "plan.reason";
  if (before.includes("warningsI18n:")) return "plan.warning";
  if (/\bkey:\s*[^,]+,\s*$/.test(before)) return "validation";
  return "log";
}

test("every code literal in server/src has an en key in its namespace", () => {
  const missing = [];
  let seen = 0;
  for (const file of files(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/new SuiteError\(\s*"([a-z_0-9]+)"/g)) {
      seen++;
      if (!has(`errors.${m[1]}`)) missing.push(`${path.relative(SRC, file)}: errors.${m[1]}`);
    }
    for (const m of text.matchAll(/\bcode:\s*"([a-z_0-9]+)"/g)) {
      seen++;
      const key = `${namespaceFor(text, m.index)}.${m[1]}`;
      if (!has(key)) missing.push(`${path.relative(SRC, file)}: ${key}`);
    }
  }
  assert.ok(seen > 50, `scanner found only ${seen} codes`);
  assert.deepEqual(missing, []);
});
