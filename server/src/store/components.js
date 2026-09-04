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

// Capped so a component edited often forever doesn't grow an unbounded
// table — 10 is plenty for "I changed something, put it back" without
// needing its own retention setting.
const HISTORY_LIMIT = 10;

export function saveComponentValues(kind, values, key = "") {
  const db = getDatabase();
  const existing = db.prepare("SELECT config_json FROM components WHERE kind = ? AND key = ?").get(kind, key);
  const nextJson = JSON.stringify(values);

  // Only a save that actually changes something is worth a history entry —
  // recording an identical no-op save would just burn through the cap for
  // nothing. Restoring a past version is itself a save, so it lands here
  // too: undo-of-undo needs no special casing.
  if (existing && existing.config_json !== nextJson) {
    db.prepare("INSERT INTO component_history (kind, key, config_json) VALUES (?, ?, ?)").run(
      kind,
      key,
      existing.config_json
    );
    db.prepare(
      `DELETE FROM component_history WHERE kind = ? AND key = ? AND id NOT IN (
         SELECT id FROM component_history WHERE kind = ? AND key = ?
         ORDER BY created_at DESC, id DESC LIMIT ?
       )`
    ).run(kind, key, kind, key, HISTORY_LIMIT);
  }

  db.prepare(
    `INSERT INTO components (kind, key, config_json, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(kind, key) DO UPDATE SET config_json = excluded.config_json, updated_at = datetime('now')`
  ).run(kind, key, nextJson);
}

// Newest first, capped by default at the same limit saves are pruned to —
// there is never more than HISTORY_LIMIT rows to list anyway, but a caller
// can ask for fewer.
export function listComponentHistory(kind, key = "", limit = HISTORY_LIMIT) {
  return getDatabase()
    .prepare(
      "SELECT id, created_at FROM component_history WHERE kind = ? AND key = ? ORDER BY created_at DESC, id DESC LIMIT ?"
    )
    .all(kind, key, limit);
}

export function getComponentHistoryEntry(id) {
  return getDatabase().prepare("SELECT * FROM component_history WHERE id = ?").get(id) || null;
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
