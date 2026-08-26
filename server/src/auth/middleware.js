// Cookie parsing, the auth gate, and login throttling.
//
// Cookies are parsed by hand rather than pulling in cookie-parser: the Suite
// sets exactly one cookie and this keeps the dependency list at express alone,
// which matters for an image that is meant to be easy to audit.

import { randomBytes } from "node:crypto";
import { SESSION_COOKIE, resolveSession, safeEqual } from "./sessions.js";
import { countUsers } from "./users.js";

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      out[key] = part.slice(idx + 1).trim();
    }
  }
  return out;
}

export function serializeCookie(name, value, { maxAgeMs, secure, expires } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (secure) parts.push("Secure");
  if (expires) parts.push(`Expires=${new Date(0).toUTCString()}`, "Max-Age=0");
  else if (maxAgeMs) parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  return parts.join("; ");
}

// Behind Caddy the browser speaks HTTPS while this process sees HTTP, so the
// forwarded proto decides whether the cookie may carry Secure. Getting this
// wrong in the strict direction silently breaks login over plain HTTP on a LAN,
// which is a legitimate way to run the Suite.
export function isSecureRequest(req) {
  const proto = (req.headers["x-forwarded-proto"] || "").toString().split(",")[0].trim();
  return proto === "https" || req.protocol === "https";
}

export function attachSession(req, res, next) {
  req.cookies = parseCookies(req.headers.cookie);
  const token = req.cookies[SESSION_COOKIE];
  req.sessionToken = token || null;
  req.user = token ? resolveSession(token) : null;
  next();
}

export function requireAuth(req, res, next) {
  if (req.user) return next();
  // setupRequired is always present, never merely absent: the frontend uses it
  // to choose between the setup form and the login form, and an undefined would
  // make "no admin yet" and "signed out" look the same on a 401.
  const setupRequired = countUsers() === 0;
  return res.status(401).json({
    error: setupRequired ? "Setup required" : "Authentication required",
    setupRequired,
  });
}

// Double-submit CSRF: SameSite=Lax already blocks cross-site POSTs from a
// plain form, but not a same-site subdomain, so state-changing requests must
// also echo the session token in a header the browser will not attach for
// anyone else.
export function requireCsrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const header = req.get("X-Suite-CSRF");
  if (req.sessionToken && safeEqual(header, req.sessionToken)) return next();
  return res.status(403).json({ error: "Invalid or missing CSRF token" });
}

// Login throttle. In-memory is the right scope: a single-admin Suite has one
// process, and a restart clearing the counters is not an attack worth caring
// about compared with the dependency a shared store would add.
//
// Two counters, and the second is the one that actually holds. `trust proxy` is
// on so cookies can carry Secure behind Caddy, which means req.ip is taken from
// a client-supplied X-Forwarded-For — an attacker who rotates that header gets a
// fresh per-IP budget on every attempt. The global counter cannot be spoofed
// around, and with exactly one legitimate user a global ceiling this generous
// never gets in their way.
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const MAX_ATTEMPTS_GLOBAL = 30;

let globalAttempts = { count: 0, first: 0 };

function rollWindow(entry, now) {
  return entry && now - entry.first <= WINDOW_MS ? entry : null;
}

export function throttleLogin(req, res, next) {
  const now = Date.now();
  const key = req.ip || "unknown";

  const perIp = rollWindow(attempts.get(key), now);
  if (!perIp) attempts.delete(key);
  const global = rollWindow(globalAttempts.count ? globalAttempts : null, now);
  if (!global) globalAttempts = { count: 0, first: 0 };

  const blocked =
    (perIp && perIp.count >= MAX_ATTEMPTS) ||
    (global && global.count >= MAX_ATTEMPTS_GLOBAL);

  if (blocked) {
    const first = Math.max(perIp ? perIp.first : 0, global ? global.first : 0);
    const retryAfter = Math.max(1, Math.ceil((first + WINDOW_MS - now) / 1000));
    res.set("Retry-After", String(retryAfter));
    return res.status(429).json({
      error: `Too many sign-in attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
    });
  }
  next();
}

export function recordFailedLogin(req) {
  const now = Date.now();
  const key = req.ip || "unknown";

  const entry = attempts.get(key);
  if (entry && now - entry.first <= WINDOW_MS) entry.count += 1;
  else attempts.set(key, { count: 1, first: now });

  if (globalAttempts.count && now - globalAttempts.first <= WINDOW_MS) globalAttempts.count += 1;
  else globalAttempts = { count: 1, first: now };
}

// A success clears this client's budget but deliberately not the global one:
// otherwise one valid sign-in would reset a brute-force run in progress.
export function clearLoginAttempts(req) {
  attempts.delete(req.ip || "unknown");
}

// Test seam — the counters are module state by design.
export function _resetLoginThrottle() {
  attempts.clear();
  globalAttempts = { count: 0, first: 0 };
}

export function newToken() {
  return randomBytes(32).toString("base64url");
}
