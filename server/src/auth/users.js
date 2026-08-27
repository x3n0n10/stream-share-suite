// The single admin account. The blueprint settles on one admin per deployment:
// no roles, no audit log. countUsers() is what the rest of the app uses to tell
// "first run" from "signed out".

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

export async function createUser(username, password) {
  const hash = await hashPassword(password);
  const res = getDatabase()
    .prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
    .run(username, hash);
  return { id: Number(res.lastInsertRowid), username };
}

export async function checkCredentials(username, password) {
  const user = getUserByUsername(username);
  if (!user) {
    // Hash anyway so a missing username costs the same wall-clock time as a
    // wrong password — otherwise the response time enumerates accounts.
    await verifyPassword(password, "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
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
