// Password hashing with scrypt from node:crypto.
//
// scrypt rather than a bcrypt/argon2 dependency: it is memory-hard, it ships
// with Node, and this is a single-admin login rather than a credential store —
// the marginal gain from argon2id does not pay for a native dependency in an
// image that otherwise needs no build toolchain.

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

// N=2^15 puts a single hash at roughly 100ms on modest hardware, which is the
// right order for an interactive login nobody performs in bulk.
const PARAMS = { N: 32768, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, PARAMS.keylen, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    // scrypt's default maxmem (32MB) is below what N=32768 needs.
    maxmem: 256 * 1024 * 1024,
  });
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");

  let derived;
  try {
    derived = await scryptAsync(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 256 * 1024 * 1024,
    });
  } catch {
    return false;
  }

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

// Shared by the setup form and the change-password form so both refuse the
// same things. Deliberately only a length floor: composition rules push people
// toward predictable substitutions without buying much.
export function validatePassword(password) {
  if (typeof password !== "string" || password.length < 12) {
    return "Password must be at least 12 characters.";
  }
  if (password.length > 200) {
    return "Password must be at most 200 characters.";
  }
  return null;
}
