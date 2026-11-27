import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GLUETUN_SCHEMA } from "../src/schema/gluetun.js";
import { POSTGRES_SCHEMA } from "../src/schema/postgres.js";
import { INSTANCE_SCHEMA } from "../src/schema/instance.js";
import { CADDY_SCHEMA } from "../src/schema/caddy.js";
import { catalogKinds, getCatalogEntry } from "../src/reconcile/catalog.js";
import { groupSlug } from "../../web/src/lib/schemaKeys.js";

const en = JSON.parse(
  readFileSync(new URL("../../web/src/locales/en/translation.json", import.meta.url), "utf8")
);
const SCHEMAS = [GLUETUN_SCHEMA, POSTGRES_SCHEMA, INSTANCE_SCHEMA, CADDY_SCHEMA];

test("groupSlug lower-camel-cases", () => {
  assert.equal(groupSlug("DNS challenge"), "dnsChallenge");
  assert.equal(groupSlug("Health check"), "healthCheck");
  assert.equal(groupSlug("VPN"), "vpn");
});

test("en has a label for every schema field", () => {
  const missing = [];
  const want = (kind, key, part, expected) => {
    if (en.schema?.[kind]?.fields?.[key]?.[part] !== expected) missing.push(`${kind}.${key}.${part}`);
  };
  for (const s of SCHEMAS) {
    assert.ok(en.schema?.[s.kind]?.label, `schema.${s.kind}.label`);
    for (const f of s.fields) {
      want(s.kind, f.key, "label", f.label);
      if (f.help) want(s.kind, f.key, "help", f.help);
      if (f.patternMessage) want(s.kind, f.key, "patternMessage", f.patternMessage);
      // combobox option labels are provider brand names, not translated
      if (f.type === "select" && f.optionLabels) {
        for (const [value, label] of Object.entries(f.optionLabels)) {
          if (en.schema?.[s.kind]?.fields?.[f.key]?.options?.[value] !== label) {
            missing.push(`${s.kind}.${f.key}.options.${value}`);
          }
        }
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("en has every schema group", () => {
  const missing = [];
  for (const s of SCHEMAS) {
    for (const g of new Set(s.fields.map((f) => f.group).filter(Boolean))) {
      if (en.schema?.[s.kind]?.groups?.[groupSlug(g)] !== g) missing.push(`${s.kind}:${g}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("en has every catalog label and description", () => {
  for (const kind of catalogKinds()) {
    const entry = getCatalogEntry(kind);
    assert.equal(en.catalog?.[kind]?.label, entry.label, `catalog.${kind}.label`);
    assert.equal(en.catalog?.[kind]?.description, entry.description, `catalog.${kind}.description`);
  }
});
