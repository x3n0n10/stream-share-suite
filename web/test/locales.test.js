import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveLanguage, LANGUAGES } from "../src/locales/languages.js";
import { checkLocales } from "./checkLocales.js";

const load = (code) => JSON.parse(readFileSync(new URL(`../src/locales/${code}/translation.json`, import.meta.url), "utf8"));

test("locale files pass checkLocales", () => {
  const en = load("en");
  for (const { code } of LANGUAGES.filter((l) => l.code !== "en")) {
    assert.deepEqual(checkLocales(en, load(code)), [], code);
  }
});

test("checkLocales catches each kind of problem", () => {
  const en = { a: "x {{n}}", t: "<b>y</b>" };
  const other = { a: "y {{m}}", t: "<i>y</i>", z: "q" };
  assert.deepEqual(checkLocales(en, other), [
    "a: placeholders differ from en",
    "t: tags differ from en",
    "z: not in en",
  ]);
  assert.deepEqual(checkLocales(en, {}, { requireAll: true }), ["a: missing", "t: missing"]);
});

test("checkLocales accepts extra plural forms only when en has the plural", () => {
  const en = { d_one: "{{count}} day", d_other: "{{count}} days", s: "x" };
  assert.deepEqual(checkLocales(en, { d_one: "{{count}} jour", d_many: "{{count}} jours", d_other: "{{count}} jours" }), []);
  assert.deepEqual(checkLocales(en, { s_many: "x", e_many: "y" }), ["s_many: not in en", "e_many: not in en"]);
});

test("detects regional and unsupported languages", () => {
  assert.equal(resolveLanguage("nl-BE"), "nl");
  assert.equal(resolveLanguage("de"), "de");
  assert.equal(resolveLanguage("pt-BR"), "en");
  assert.equal(resolveLanguage(""), "en");
});
