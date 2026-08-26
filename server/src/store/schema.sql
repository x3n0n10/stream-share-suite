-- StreamShare Suite configuration store.
--
-- This is the Suite's *own* database and is deliberately not the PostgreSQL it
-- manages: the Suite has to boot, serve a UI and accept the first answers of
-- setup before any other container exists, so its store cannot be one of the
-- things it creates. SQLite also happens to fit the shape of the data — one
-- writer, a few dozen rows, and a backup that is a single file copy.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

-- Single-row-per-key settings. Values are TEXT; callers coerce.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per StreamShare instance. In this stack an instance is one IPTV
-- provider, so `name` is the provider's friendly name.
--
-- api_key is a secret: it is never returned by the HTTP API, only replaced.
CREATE TABLE IF NOT EXISTS instances (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT    NOT NULL UNIQUE,
  name       TEXT    NOT NULL,
  url        TEXT    NOT NULL,
  api_key    TEXT    NOT NULL DEFAULT '',
  position   INTEGER NOT NULL DEFAULT 0,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_instances_position ON instances(position, id);

-- Single admin per deployment (see the blueprint: no roles, no audit log).
-- password_hash is scrypt; see auth/passwords.js for the encoding.
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Opaque session tokens. Only the SHA-256 of the token is stored, so a stolen
-- database file does not hand over live sessions.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  last_seen   TEXT NOT NULL DEFAULT (datetime('now')),
  user_agent  TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
