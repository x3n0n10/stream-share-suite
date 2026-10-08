// The single long-lived API token. Like sessions, only its SHA-256 is stored,
// so a leaked database file or backup yields no usable token. One token is the
// whole model: generating again replaces it, and there are no scopes — what a
// token may reach is the route allowlist in middleware.js.

import { randomBytes } from "node:crypto";
import { hashToken, safeEqual } from "./sessions.js";
import { deleteSetting, getSetting, setSettings } from "../store/settings.js";

const HASH_KEY = "api.token_hash";
const CREATED_KEY = "api.token_created_at";

export function apiTokenStatus() {
  const exists = !!getSetting(HASH_KEY);
  return { exists, createdAt: exists ? getSetting(CREATED_KEY) : null };
}

export function generateApiToken() {
  const token = randomBytes(32).toString("base64url");
  const createdAt = new Date().toISOString();
  setSettings({ [HASH_KEY]: hashToken(token), [CREATED_KEY]: createdAt });
  return { token, createdAt };
}

export function revokeApiToken() {
  deleteSetting(HASH_KEY);
  deleteSetting(CREATED_KEY);
}

export function verifyApiToken(token) {
  return !!token && safeEqual(hashToken(token), getSetting(HASH_KEY));
}
