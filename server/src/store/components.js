// Desired-state storage for reconciler-managed components.
//
// Rows are identified by (kind, key). A singleton component — gluetun today,
// postgres and caddy later — uses the empty-string key and callers can simply
// omit it. A kind with several instances passes a real key, which is what
// lets phase 2b store four StreamShare instances under one kind.

import { getDatabase } from "./db.js";

// The id a component is known by outside the store: "gluetun" for a
// singleton, "instance:provider-1" for one of many. Used for the dependency
// graph's node ids and in a plan's rows, so both agree on what a component is
// called without either having to know the (kind, key) split.
export function componentId(kind, key = "") {
  return key ? `${kind}:${key}` : kind;
}

export function getComponentValues(kind, key = "") {
  const row = getDatabase()
    .prepare("SELECT config_json FROM components WHERE kind = ? AND key = ?")
    .get(kind, key);
  return row ? JSON.parse(row.config_json) : {};
}

export function getComponentRow(kind, key = "") {
  return (
    getDatabase().prepare("SELECT * FROM components WHERE kind = ? AND key = ?").get(kind, key) ||
    null
  );
}

// Every stored component of one kind, oldest first. Phase 2b's instance list
// reads through this; nothing in 2a has more than one of anything.
export function listComponents(kind) {
  return getDatabase()
    .prepare("SELECT * FROM components WHERE kind = ? ORDER BY created_at, key")
    .all(kind);
}

export function saveComponentValues(kind, values, key = "") {
  getDatabase()
    .prepare(
      `INSERT INTO components (kind, key, config_json, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(kind, key) DO UPDATE SET config_json = excluded.config_json, updated_at = datetime('now')`
    )
    .run(kind, key, JSON.stringify(values));
}

export function deleteComponent(kind, key = "") {
  const res = getDatabase()
    .prepare("DELETE FROM components WHERE kind = ? AND key = ?")
    .run(kind, key);
  return res.changes > 0;
}

export function setAdoptedContainer(kind, containerId, key = "") {
  getDatabase()
    .prepare(
      `INSERT INTO components (kind, key, adopted_container_id, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(kind, key) DO UPDATE SET adopted_container_id = excluded.adopted_container_id, updated_at = datetime('now')`
    )
    .run(kind, key, containerId);
}

export function clearAdoption(kind, key = "") {
  getDatabase()
    .prepare(
      "UPDATE components SET adopted_container_id = NULL, updated_at = datetime('now') WHERE kind = ? AND key = ?"
    )
    .run(kind, key);
}
