// Opens the Suite's SQLite store and keeps its schema current.
//
// node:sqlite is used deliberately over a native module: it ships with Node,
// so the runtime image needs no build toolchain and there is nothing to
// recompile when the base image moves.

import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Bumped whenever schema.sql gains a migration below.
export const SCHEMA_VERSION = 2;

let db = null;

export function openDatabase(dataDir) {
  if (db) return db;

  try {
    mkdirSync(dataDir, { recursive: true });
  } catch (err) {
    throw new Error(
      `Cannot create the data directory ${dataDir}: ${err.message}\n` +
        describePermissions(dataDir)
    );
  }

  const file = path.join(dataDir, "suite.db");

  try {
    db = new DatabaseSync(file);
  } catch (err) {
    // SQLITE_CANTOPEN on a directory that exists is almost always ownership:
    // the process cannot create a file in it. The raw error says none of that,
    // and it is the first thing anyone hits on a bind-mounted volume.
    throw new Error(
      `Cannot open the store at ${file}: ${err.message}\n` + describePermissions(dataDir)
    );
  }
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

// Turns a permission failure into something an operator can act on: who we are,
// who owns the directory, and the two ways to reconcile them. Best-effort — if
// even stat fails we still want the original error to surface.
function describePermissions(dataDir) {
  const me = `uid ${process.getuid?.() ?? "?"}:${process.getgid?.() ?? "?"}`;
  let owner = "unknown";
  try {
    const st = statSync(dataDir);
    owner = `uid ${st.uid}:${st.gid}`;
  } catch {
    // directory may not exist — the message below still applies
  }
  return (
    `  This process runs as ${me}; ${dataDir} is owned by ${owner}.\n` +
    `  In Docker, set PUID/PGID to the owning ids (Unraid uses PUID=99 PGID=100)\n` +
    `  so the entrypoint can take ownership, or chown the directory on the host.`
  );
}

// Forward-only migrations. Each case falls through to the next so a store
// several versions behind catches up in one pass.
//
// Note that schema.sql has already run by the time this is called, and every
// statement in it is CREATE TABLE IF NOT EXISTS — so it creates what a fresh
// store needs and leaves an existing table alone. Reshaping an existing table
// is this function's job, never schema.sql's.
function migrate(database, from) {
  /* eslint-disable no-fallthrough */
  switch (from) {
    // v1 keyed components by kind alone, which allows exactly one row per
    // kind. Instances need many, so the primary key becomes (kind, key) with
    // the empty string standing for "the only one of its kind". SQLite cannot
    // alter a primary key in place, hence the rebuild.
    case 1:
      database.exec(`
        ALTER TABLE components RENAME TO components_v1;

        CREATE TABLE components (
          kind                 TEXT NOT NULL,
          key                  TEXT NOT NULL DEFAULT '',
          config_json          TEXT NOT NULL DEFAULT '{}',
          adopted_container_id TEXT,
          created_at           TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (kind, key)
        );

        INSERT INTO components (kind, key, config_json, adopted_container_id, created_at, updated_at)
          SELECT kind, '', config_json, adopted_container_id, created_at, updated_at
            FROM components_v1;

        DROP TABLE components_v1;
      `);

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
