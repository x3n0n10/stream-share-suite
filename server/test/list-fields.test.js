import { test } from "node:test";
import assert from "node:assert/strict";
import { GLUETUN_SCHEMA } from "../src/schema/gluetun.js";
import { POSTGRES_SCHEMA } from "../src/schema/postgres.js";
import { CADDY_SCHEMA } from "../src/schema/caddy.js";
import { INSTANCE_SCHEMA } from "../src/schema/instance.js";

const field = (schema, key) => schema.fields.find((f) => f.key === key);

test("comma-separated fields are declared as list fields", () => {
  const expected = [
    [GLUETUN_SCHEMA, "serverHostnames", "text"],
    [GLUETUN_SCHEMA, "serverCategories", "text"],
    [GLUETUN_SCHEMA, "serverRegions", "text"],
    [GLUETUN_SCHEMA, "networks", "text"],
    [POSTGRES_SCHEMA, "networks", "text"],
    [CADDY_SCHEMA, "networks", "text"],
    [INSTANCE_SCHEMA, "healthCheckBlockedCodes", "number"],
  ];
  for (const [schema, key, itemType] of expected) {
    const f = field(schema, key);
    assert.equal(f.type, "list", `${schema.kind}.${key} type`);
    assert.equal(f.itemType, itemType, `${schema.kind}.${key} itemType`);
    assert.ok(!f.sort, `${schema.kind}.${key} must keep insertion order`);
  }
});
