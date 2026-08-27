// The v1 -> v2 migration, run against a real file-backed store rather than a
// reconstructed one.
//
// This is the first migration the project has had to perform on data someone
// is actually running, so it is exercised the way it will really happen: build
// a v1 database by hand, open it with the current code, and check that what
// was in it survived.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDatabase, closeDatabase, SCHEMA_VERSION } from "../src/store/db.js";

const dirs = [];

function v1Store() {
  const dir = mkdtempSync(path.join(tmpdir(), "suite-migration-"));
  dirs.push(dir);

  const db = new DatabaseSync(path.join(dir, "suite.db"));
  db.exec(`
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    CREATE TABLE settings (
      key TEXT PRIMARY KEY, value TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE components (
      kind                 TEXT PRIMARY KEY,
      config_json          TEXT NOT NULL DEFAULT '{}',
      adopted_container_id TEXT,
      created_at           TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO schema_version (version) VALUES (1);
  `);
  return { dir, db };
}

afterEach(() => {
  closeDatabase();
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

test("a v1 component survives the move to (kind, key) with its config intact", () => {
  const { dir, db } = v1Store();
  db.prepare("INSERT INTO components (kind, config_json) VALUES (?, ?)").run(
    "gluetun",
    JSON.stringify({ vpnServiceProvider: "nordvpn", wireguardPrivateKey: "secret" })
  );
  db.close();

  const migrated = openDatabase(dir);

  const row = migrated.prepare("SELECT * FROM components WHERE kind = ?").get("gluetun");
  assert.equal(row.key, "", "a singleton lands on the empty key");
  assert.deepEqual(JSON.parse(row.config_json), {
    vpnServiceProvider: "nordvpn",
    wireguardPrivateKey: "secret",
  });
});

test("an adopted container id survives the migration", () => {
  const { dir, db } = v1Store();
  db.prepare("INSERT INTO components (kind, config_json, adopted_container_id) VALUES (?, ?, ?)").run(
    "gluetun",
    "{}",
    "foreign-container-id"
  );
  db.close();

  const migrated = openDatabase(dir);
  const row = migrated.prepare("SELECT * FROM components WHERE kind = ?").get("gluetun");
  assert.equal(row.adopted_container_id, "foreign-container-id");
});

test("the migration records the new schema version and does not run twice", () => {
  const { dir, db } = v1Store();
  db.prepare("INSERT INTO components (kind, config_json) VALUES (?, ?)").run("gluetun", "{}");
  db.close();

  const migrated = openDatabase(dir);
  assert.equal(migrated.prepare("SELECT version FROM schema_version LIMIT 1").get().version, SCHEMA_VERSION);

  // Re-opening from disk must be a no-op rather than a second attempt to
  // rename a table that no longer exists.
  closeDatabase();
  const reopened = openDatabase(dir);
  assert.equal(reopened.prepare("SELECT version FROM schema_version LIMIT 1").get().version, SCHEMA_VERSION);
  assert.equal(reopened.prepare("SELECT COUNT(*) AS n FROM components").get().n, 1);
});

test("after migrating, the new composite key allows several rows of one kind", () => {
  const { dir, db } = v1Store();
  db.prepare("INSERT INTO components (kind, config_json) VALUES (?, ?)").run("gluetun", "{}");
  db.close();

  const migrated = openDatabase(dir);
  migrated
    .prepare("INSERT INTO components (kind, key, config_json) VALUES (?, ?, ?)")
    .run("instance", "provider-1", "{}");
  migrated
    .prepare("INSERT INTO components (kind, key, config_json) VALUES (?, ?, ?)")
    .run("instance", "provider-2", "{}");

  const n = migrated.prepare("SELECT COUNT(*) AS n FROM components WHERE kind = ?").get("instance").n;
  assert.equal(n, 2);
});

test("a fresh store is created at the current version without migrating", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "suite-fresh-"));
  dirs.push(dir);

  const db = openDatabase(dir);
  assert.equal(db.prepare("SELECT version FROM schema_version LIMIT 1").get().version, SCHEMA_VERSION);

  // The composite key must be in place from the start, not only after a
  // migration — this is the shape most installs will actually have.
  db.prepare("INSERT INTO components (kind, key, config_json) VALUES (?, ?, ?)").run("instance", "a", "{}");
  db.prepare("INSERT INTO components (kind, key, config_json) VALUES (?, ?, ?)").run("instance", "b", "{}");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM components").get().n, 2);
});
