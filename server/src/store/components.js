// Desired-state storage for reconciler-managed components. One row per kind
// ("gluetun" today); config_json holds that kind's schema field values.

import { getDatabase } from "./db.js";

export function getComponentValues(kind) {
  const row = getDatabase().prepare("SELECT config_json FROM components WHERE kind = ?").get(kind);
  return row ? JSON.parse(row.config_json) : {};
}

export function getComponentRow(kind) {
  return getDatabase().prepare("SELECT * FROM components WHERE kind = ?").get(kind) || null;
}

export function saveComponentValues(kind, values) {
  getDatabase()
    .prepare(
      `INSERT INTO components (kind, config_json, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(kind) DO UPDATE SET config_json = excluded.config_json, updated_at = datetime('now')`
    )
    .run(kind, JSON.stringify(values));
}

export function setAdoptedContainer(kind, containerId) {
  getDatabase()
    .prepare(
      `INSERT INTO components (kind, adopted_container_id, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(kind) DO UPDATE SET adopted_container_id = excluded.adopted_container_id, updated_at = datetime('now')`
    )
    .run(kind, containerId);
}

export function clearAdoption(kind) {
  getDatabase()
    .prepare("UPDATE components SET adopted_container_id = NULL, updated_at = datetime('now') WHERE kind = ?")
    .run(kind);
}
