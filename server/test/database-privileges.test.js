import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { ensureDatabase } from "../src/reconcile/database.js";

// Fake pg.Client recording queries; `admin` is the answer to the
// current-user lookup, `exists` whether the role/database already exist.
function run(admin, exists = false) {
  const sql = [];
  const Real = pg.Client;
  pg.Client = class {
    async connect() {}
    async end() {}
    async query(text) {
      sql.push(text);
      if (/FROM pg_roles WHERE rolname = current_user/.test(text)) return { rows: [admin], rowCount: 1 };
      return { rows: [], rowCount: exists ? 1 : 0 };
    }
  };
  return ensureDatabase({ host: "h", port: 1, user: "adm", password: "p" }, { database: "d", user: "u", password: "pw" })
    .then(() => sql, (e) => { throw e; })
    .finally(() => { pg.Client = Real; });
}
const grants = (sql) => sql.filter((s) => s.startsWith("GRANT"));
const createDb = (sql) => sql.findIndex((s) => s.startsWith("CREATE DATABASE"));

test("non-superuser admin on PG14 gets plain membership before CREATE DATABASE", async () => {
  const sql = await run({ rolsuper: false, v: 140000 });
  assert.deepEqual(grants(sql), ['GRANT "u" TO CURRENT_USER']);
  assert.ok(sql.findIndex((s) => s.startsWith("GRANT")) < createDb(sql));
});

test("non-superuser admin on PG16+ gets SET, not just the implicit ADMIN OPTION", async () => {
  const sql = await run({ rolsuper: false, v: 170000 });
  assert.deepEqual(grants(sql), ['GRANT "u" TO CURRENT_USER WITH SET TRUE']);
});

test("non-superuser admin is granted again when the role already exists", async () => {
  const sql = await run({ rolsuper: false, v: 170000 }, true);
  assert.equal(grants(sql).length, 1);
});

test("superuser admin needs no grant", async () => {
  assert.deepEqual(grants(await run({ rolsuper: true, v: 170000 })), []);
});
