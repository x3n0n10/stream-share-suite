import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers.js";
import { hashPassword, validatePassword, verifyPassword } from "../src/auth/passwords.js";
import { checkCredentials, countUsers, createUser } from "../src/auth/users.js";
import {
  createSession,
  destroyAllSessions,
  destroySession,
  resolveSession,
  safeEqual,
} from "../src/auth/sessions.js";
import { parseCookies, serializeCookie } from "../src/auth/middleware.js";

beforeEach(() => freshDatabase());

test("a hash verifies against its password and nothing else", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("correct horse battery staple", hash), true);
  assert.equal(await verifyPassword("Correct horse battery staple", hash), false);
  assert.equal(await verifyPassword("", hash), false);
});

test("hashing is salted, so the same password hashes differently each time", async () => {
  const a = await hashPassword("a-very-long-password");
  const b = await hashPassword("a-very-long-password");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("a-very-long-password", b), true);
});

test("a malformed stored hash is rejected rather than throwing", async () => {
  assert.equal(await verifyPassword("x", "not-a-hash"), false);
  assert.equal(await verifyPassword("x", ""), false);
  assert.equal(await verifyPassword("x", null), false);
  assert.equal(await verifyPassword("x", "scrypt$bad$bad$bad$bad$bad"), false);
});

test("passwords must clear a length floor", () => {
  assert.ok(validatePassword("short"));
  assert.equal(validatePassword("twelve chars"), null);
});

test("credentials check against the stored user", async () => {
  await createUser("admin", "a-sufficiently-long-password");
  assert.equal(countUsers(), 1);

  assert.equal((await checkCredentials("admin", "a-sufficiently-long-password")).username, "admin");
  assert.equal(await checkCredentials("admin", "wrong"), null);
  assert.equal(await checkCredentials("nobody", "a-sufficiently-long-password"), null);
});

test("a session resolves once and stops resolving after it is destroyed", async () => {
  const user = await createUser("admin", "a-sufficiently-long-password");
  const session = createSession(user.id);

  assert.equal(resolveSession(session.token).username, "admin");
  destroySession(session.token);
  assert.equal(resolveSession(session.token), null);
});

test("the raw session token is never stored", async () => {
  const db = freshDatabase();
  const user = await createUser("admin", "a-sufficiently-long-password");
  const session = createSession(user.id);

  const rows = db.prepare("SELECT token_hash FROM sessions").all();
  assert.equal(rows.length, 1);
  // Only the SHA-256 is persisted, so a leaked database file yields no live
  // sessions — which matters because that file also holds the instance keys.
  assert.notEqual(rows[0].token_hash, session.token);
  assert.equal(rows[0].token_hash.length, 64);
  assert.match(rows[0].token_hash, /^[0-9a-f]{64}$/);
});

test("an expired session does not resolve", async () => {
  const db = freshDatabase();
  const user = await createUser("admin", "a-sufficiently-long-password");
  const session = createSession(user.id);

  db.prepare("UPDATE sessions SET expires_at = ?").run(new Date(Date.now() - 1000).toISOString());
  assert.equal(resolveSession(session.token), null);
  // The expired row is cleaned up on the read that rejected it.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 0);
});

test("changing a password can drop every session but the current one", async () => {
  const user = await createUser("admin", "a-sufficiently-long-password");
  const keep = createSession(user.id);
  const other = createSession(user.id);

  destroyAllSessions(user.id, { exceptToken: keep.token });
  assert.ok(resolveSession(keep.token));
  assert.equal(resolveSession(other.token), null);
});

test("resolveSession tolerates a missing or unknown token", () => {
  assert.equal(resolveSession(null), null);
  assert.equal(resolveSession(""), null);
  assert.equal(resolveSession("not-a-real-token"), null);
});

test("safeEqual compares without throwing on length mismatch", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual("", ""), false);
  assert.equal(safeEqual(null, undefined), false);
});

test("cookies round-trip through the hand-rolled parser", () => {
  const header = serializeCookie("suite_session", "a value/with=chars", { maxAgeMs: 60000 });
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Max-Age=60/);
  assert.doesNotMatch(header, /Secure/);

  const value = header.split(";")[0].split("=").slice(1).join("=");
  assert.equal(parseCookies(`suite_session=${value}`).suite_session, "a value/with=chars");
});

test("the secure flag is only set when asked for", () => {
  assert.match(serializeCookie("x", "y", { secure: true }), /Secure/);
});

test("parseCookies handles empty, malformed and multiple cookies", () => {
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies(""), {});
  assert.deepEqual(parseCookies("novalue"), {});
  assert.deepEqual(parseCookies("a=1; b=2"), { a: "1", b: "2" });
});
