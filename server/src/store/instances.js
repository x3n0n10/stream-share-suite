// Instance rows: one StreamShare instance, which in this stack means one IPTV
// provider.
//
// api_key is a secret. Nothing here hands it to a caller except getInstances(),
// which the request path uses to actually talk to the instance; the HTTP layer
// projects rows through toPublic() so the key never reaches a browser.

import { getDatabase } from "./db.js";

function rowToInstance(row) {
  return {
    id: row.slug,
    rowId: row.id,
    name: row.name,
    url: row.url,
    apiKey: row.api_key,
    position: row.position,
    enabled: !!row.enabled,
  };
}

// The shape the HTTP API is allowed to return: the key is reduced to whether
// one is set at all.
export function toPublic(instance) {
  return {
    id: instance.id,
    name: instance.name,
    url: instance.url,
    enabled: instance.enabled,
    position: instance.position,
    apiKeySet: !!instance.apiKey,
  };
}

export function listInstances({ includeDisabled = false } = {}) {
  const sql = includeDisabled
    ? "SELECT * FROM instances ORDER BY position, id"
    : "SELECT * FROM instances WHERE enabled = 1 ORDER BY position, id";
  return getDatabase().prepare(sql).all().map(rowToInstance);
}

export function getInstance(slug) {
  const row = getDatabase().prepare("SELECT * FROM instances WHERE slug = ?").get(slug);
  return row ? rowToInstance(row) : null;
}

// Derives a URL-safe, unique slug from the display name. The slug is the id
// the HTTP API and the frontend use, so it stays stable once assigned even if
// the instance is later renamed.
export function slugify(name, { exclude = null } = {}) {
  const base =
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "instance";

  const db = getDatabase();
  let candidate = base;
  for (let n = 2; ; n++) {
    const clash = db.prepare("SELECT slug FROM instances WHERE slug = ?").get(candidate);
    if (!clash || clash.slug === exclude) return candidate;
    candidate = `${base}-${n}`;
  }
}

export function createInstance({ name, url, apiKey = "", enabled = true }) {
  const db = getDatabase();
  const slug = slugify(name);
  const next =
    db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM instances").get().pos;

  db.prepare(
    `INSERT INTO instances (slug, name, url, api_key, position, enabled)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(slug, name, normaliseUrl(url), apiKey, next, enabled ? 1 : 0);

  return getInstance(slug);
}

// `apiKey` follows the write-only convention: undefined leaves the stored key
// alone, a string replaces it, and null clears it. That is what lets the edit
// form round-trip without ever having seen the current value.
export function updateInstance(slug, { name, url, apiKey, enabled }) {
  const existing = getInstance(slug);
  if (!existing) return null;

  const db = getDatabase();
  db.prepare(
    `UPDATE instances
        SET name = ?, url = ?, api_key = ?, enabled = ?, updated_at = datetime('now')
      WHERE slug = ?`
  ).run(
    name ?? existing.name,
    url === undefined ? existing.url : normaliseUrl(url),
    apiKey === undefined ? existing.apiKey : apiKey === null ? "" : apiKey,
    (enabled === undefined ? existing.enabled : enabled) ? 1 : 0,
    slug
  );

  return getInstance(slug);
}

export function deleteInstance(slug) {
  const res = getDatabase().prepare("DELETE FROM instances WHERE slug = ?").run(slug);
  return res.changes > 0;
}

export function reorderInstances(slugs) {
  const db = getDatabase();
  db.exec("BEGIN");
  try {
    const stmt = db.prepare("UPDATE instances SET position = ? WHERE slug = ?");
    slugs.forEach((slug, idx) => stmt.run(idx, slug));
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function countInstances() {
  return getDatabase().prepare("SELECT COUNT(*) AS n FROM instances").get().n;
}

function normaliseUrl(url) {
  return String(url).trim().replace(/\/+$/, "");
}
