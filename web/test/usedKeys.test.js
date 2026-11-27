import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const en = JSON.parse(readFileSync(new URL("../src/locales/en/translation.json", import.meta.url), "utf8"));

const resolve = (key) => key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), en);
const exists = (key) => [key, `${key}_one`, `${key}_other`].some((k) => typeof resolve(k) === "string");

function* sources(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name !== "locales") yield* sources(p);
    } else if (/\.jsx?$/.test(e.name)) yield p;
  }
}

test("every static t(\"…\") / i18nKey=\"…\" key exists in en/translation.json", () => {
  const root = new URL("../src", import.meta.url).pathname;
  const missing = [];
  // Static string literals only: template-literal keys are skipped.
  const re = /(?:\bt\(\s*|i18nKey=)(["'])([\w.-]+)\1/g;
  for (const file of sources(root)) {
    for (const m of readFileSync(file, "utf8").matchAll(re)) {
      if (!exists(m[2])) missing.push(`${file.slice(root.length + 1)}: ${m[2]}`);
    }
  }
  assert.deepEqual(missing, []);
});
