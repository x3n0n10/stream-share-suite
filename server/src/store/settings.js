// Key/value settings. Values are stored as TEXT and coerced by the reader, so
// there is exactly one place that knows a setting's type: its accessor here.

import { getDatabase } from "./db.js";

export function getSetting(key, fallback = null) {
  const row = getDatabase().prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

export function getNumber(key, fallback) {
  const raw = getSetting(key);
  const n = Number(raw);
  return raw !== null && raw !== "" && Number.isFinite(n) ? n : fallback;
}

export function getBoolean(key, fallback = false) {
  const raw = getSetting(key);
  if (raw === null) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

export function setSetting(key, value) {
  getDatabase()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    )
    .run(key, value === null || value === undefined ? null : String(value));
}

export function setSettings(entries) {
  const db = getDatabase();
  db.exec("BEGIN");
  try {
    for (const [key, value] of Object.entries(entries)) setSetting(key, value);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function deleteSetting(key) {
  getDatabase().prepare("DELETE FROM settings WHERE key = ?").run(key);
}
