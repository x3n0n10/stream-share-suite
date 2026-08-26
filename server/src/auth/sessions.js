// Opaque session tokens kept in the store.
//
// The cookie carries a random token; the database holds only its SHA-256. A
// leaked database file therefore yields no usable sessions, which matters more
// here than usual because that same file holds the instance API keys.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getDatabase } from "../store/db.js";

export const SESSION_COOKIE = "suite_session";

// Sliding window: every authenticated request pushes the expiry out, so an
// active operator is never logged out mid-task, while an idle session dies.
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(userId, { userAgent } = {}) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  getDatabase()
    .prepare(
      `INSERT INTO sessions (token_hash, user_id, expires_at, user_agent)
       VALUES (?, ?, ?, ?)`
    )
    .run(hashToken(token), userId, expiresAt, (userAgent || "").slice(0, 200));

  return { token, expiresAt, maxAgeMs: SESSION_TTL_MS };
}

export function resolveSession(token) {
  if (!token) return null;

  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT s.token_hash, s.user_id, s.expires_at, s.last_seen, u.username
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`
    )
    .get(hashToken(token));

  if (!row) return null;

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(row.token_hash);
    return null;
  }

  // Writing on every request would turn a read-heavy polling dashboard into a
  // write-heavy one — the poll interval is 15s and every page polls. Push the
  // expiry at most hourly instead; the window is 14 days, so the imprecision
  // costs nothing.
  if (Date.now() - new Date(row.last_seen).getTime() > TOUCH_INTERVAL_MS) {
    db.prepare(
      `UPDATE sessions
          SET last_seen = datetime('now'), expires_at = ?
        WHERE token_hash = ?`
    ).run(new Date(Date.now() + SESSION_TTL_MS).toISOString(), row.token_hash);
  }

  return { userId: row.user_id, username: row.username };
}

export function destroySession(token) {
  if (!token) return;
  getDatabase().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

// Used after a password change: everything else signed in with the old
// password should stop working.
export function destroyAllSessions(userId, { exceptToken } = {}) {
  const db = getDatabase();
  if (exceptToken) {
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(
      userId,
      hashToken(exceptToken)
    );
  } else {
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }
}

export function pruneExpiredSessions() {
  getDatabase().prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
}

// Constant-time compare for the CSRF double-submit check below.
export function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ""));
  const bufB = Buffer.from(String(b || ""));
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}
