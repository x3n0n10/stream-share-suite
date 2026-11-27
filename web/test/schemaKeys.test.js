import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldText, groupText, catalogText } from "../src/lib/schemaKeys.js";

const dict = {
  "schema.caddy.fields.acmeEmail.label": "E-mail",
  "schema.caddy.groups.dnsChallenge": "DNS-uitdaging",
  "catalog.caddy.label": "Caddy (omgekeerde proxy)",
};
const t = (key, o) => dict[key] ?? o.defaultValue;

test("helpers use the key layout and fall back to English", () => {
  assert.equal(fieldText(t, "caddy", "acmeEmail", "label", "Email"), "E-mail");
  assert.equal(fieldText(t, "caddy", "acmeEmail", "help", "Help"), "Help");
  assert.equal(groupText(t, "caddy", "DNS challenge"), "DNS-uitdaging");
  assert.equal(groupText(t, "caddy", "Other"), "Other");
  assert.equal(catalogText(t, { kind: "caddy", label: "Caddy", description: "D" }, "label"), "Caddy (omgekeerde proxy)");
  assert.equal(catalogText(t, { kind: "caddy", label: "Caddy", description: "D" }, "description"), "D");
  assert.equal(catalogText(t, { kind: "instance", label: "My Provider" }, "label"), "My Provider");
});
