// Opens the Suite's SQLite store and keeps its schema current.
//
// node:sqlite is used deliberately over a native module: it ships with Node,
// so the runtime image needs no build toolchain and there is nothing to
// recompile when the base image moves.

import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Bumped whenever schema.sql gains a migration below.
const SCHEMA_VERSION = 1;

let db = null;

export function openDatabase(dataDir) {
  if (db) return db;

  mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "suite.db");

  db = new DatabaseSync(file);
  db.exec(readFileSync(path.join(__dirname, "schema.sql"), "utf8"));

  const row = db.prepare("SELECT version FROM schema_version LIMIT 1").get();
  if (!row) {
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
  } else if (row.version < SCHEMA_VERSION) {
    migrate(db, row.version);
    db.prepare("UPDATE schema_version SET version = ?").run(SCHEMA_VERSION);
  }

  // The file holds provider passwords and instance API keys in the clear, so
  // keep it unreadable to anything but the owner. Best-effort: some volume
  // drivers reject chmod, and failing to start over it would be worse than
  // running with the driver's own permissions.
  try {
    chmodSync(file, 0o600);
  } catch {
    // ignore
  }

  return db;
}

// Forward-only migrations. Each case falls through to the next so a store
// several versions behind catches up in one pass.
function migrate(database, from) {
  /* eslint-disable no-fallthrough */
  switch (from) {
    // case 1:
    //   database.exec("ALTER TABLE instances ADD COLUMN channel TEXT NOT NULL DEFAULT 'stable'");
    default:
      break;
  }
  /* eslint-enable no-fallthrough */
}

export function getDatabase() {
  if (!db) throw new Error("Database not opened — call openDatabase() first");
  return db;
}

// Test seam: lets a suite open a fresh in-memory store per case.
export function _setDatabaseForTests(instance) {
  db = instance;
}

export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}
