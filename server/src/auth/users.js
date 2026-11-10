// The single admin account. The blueprint settles on one admin per deployment:
// no roles, no audit log. countUsers() is what the rest of the app uses to tell
// "first run" from "signed out".

import { randomBytes } from "node:crypto";
import { getDatabase } from "../store/db.js";
import { hashPassword, verifyPassword } from "./passwords.js";

export function countUsers() {
  return getDatabase().prepare("SELECT COUNT(*) AS n FROM users").get().n;
}

export function getUserByUsername(username) {
  return getDatabase().prepare("SELECT * FROM users WHERE username = ?").get(username) || null;
}

export function getUserById(id) {
  return getDatabase().prepare("SELECT * FROM users WHERE id = ?").get(id) || null;
}

// Creates the one admin. The emptiness check and the insert are a single
// statement, so two simultaneous setup requests (the hash above takes ~100ms)
// cannot both succeed, whatever usernames they chose.
export async function createUser(username, password) {
  const hash = await hashPassword(password);
  const res = getDatabase()
    .prepare("INSERT INTO users (username, password_hash) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)")
    .run(username, hash);
  if (res.changes === 0) throw new Error("Setup has already been completed.");
  return { id: Number(res.lastInsertRowid), username };
}

// A real hash of a throwaway password, made with the current scrypt settings,
// so a missing username costs exactly what a wrong password does.
let dummyHash;

export async function checkCredentials(username, password) {
  const user = getUserByUsername(username);
  if (!user) {
    // Hash anyway so a missing username costs the same wall-clock time as a
    // wrong password — otherwise the response time enumerates accounts.
    dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
    await verifyPassword(password, await dummyHash);
    return null;
  }
  const ok = await verifyPassword(password, user.password_hash);
  return ok ? { id: user.id, username: user.username } : null;
}

export async function changePassword(userId, newPassword) {
  const hash = await hashPassword(newPassword);
  getDatabase()
    .prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
    .run(hash, userId);
}
