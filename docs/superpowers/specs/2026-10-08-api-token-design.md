# API token: scripted VPN status and reconnect

## Problem

Reconnecting the VPN is used far more often than expected. Today it requires
signing in to the Suite and finding the button. Every API route sits behind the
session cookie and the double-submit CSRF check, so no external tool can call
it. The goal is a small, client-agnostic HTTP API that any automation tool,
script or dashboard can use to read VPN status and trigger a reconnect.

## Scope

In:

- One long-lived API token, generated and revoked under Settings.
- Bearer-token access to an explicit allowlist of routes, initially:
  - `GET /api/gluetun` (VPN status and exit IP)
  - `POST /api/gluetun/reconnect`
- Adding a route to the allowlist later is a one-line change.

Out:

- Multiple tokens, per-token scopes, token expiry.
- MCP server or any client-specific integration.
- "Connected since" / elapsed time. Gluetun does not expose it and can
  reconnect on its own without the Suite noticing, so the Suite cannot track it
  reliably. Clients derive it from their own observation of status/IP changes.

## Design

### Token storage and lifecycle

- A single token: 32 random bytes, base64url (same generator as sessions).
- Only its SHA-256 hash is stored, in the settings table under
  `api.token_hash`, with `api.token_created_at` alongside. A leaked database
  file or backup yields no usable token, matching `auth/sessions.js`.
- New routes in `routes/settings.js`, behind the normal session auth + CSRF:
  - `GET /api/settings/api-token` → `{ exists: boolean, createdAt: string|null }`
  - `POST /api/settings/api-token` → `{ token, createdAt }`. The plain token
    is returned exactly once. Generating again replaces the previous token,
    which stops working immediately.
  - `DELETE /api/settings/api-token` → revokes; returns `{ exists: false }`.
- Settings UI: an "API access" section showing whether a token exists and when
  it was created, with Generate / Regenerate and Revoke buttons. After
  generating, the token is shown once with a copy button and a note that it
  will not be shown again.

### Auth path

- Client sends `Authorization: Bearer <token>`.
- New middleware in `auth/middleware.js`, mounted in `routes/index.js`
  alongside `requireAuth`/`requireCsrf`:
  - No `Authorization: Bearer` header → existing cookie path, unchanged
    (session required, CSRF enforced).
  - Bearer header present → hash it and compare to `api.token_hash` with
    `safeEqual`. The cookie session is ignored on this path.
    - No token configured, or mismatch → 401, recorded via
      `recordFailedLogin`. The request is first passed through the
      `throttleLogin` budget, so a throttled client gets 429 + `Retry-After`.
    - Match, route not in the allowlist → 403.
    - Match, route in the allowlist → request proceeds; CSRF is skipped
      (a bearer header is never attached by a browser on its own, so CSRF does
      not apply).
- The allowlist is a single constant array of `"METHOD /path"` entries in the
  middleware module, matched against the path relative to `/api`:

  ```js
  const API_TOKEN_ROUTES = [
    "GET /gluetun",
    "POST /gluetun/reconnect",
  ];
  ```

  Exposing another route later means adding one entry plus a test.
- Existing route handlers are not modified.

### Behaviour

- `GET /api/gluetun` returns the existing shape: `enabled`, `vpn` (gluetun's
  `{ status }`), `vpnError`, `publicIp` (gluetun's public IP object: IP,
  country, city, ...), `publicIpError`.
- `POST /api/gluetun/reconnect` is synchronous: it returns once the VPN reports
  `running` again, or fails after `gluetun.reconnect_timeout_ms` (default
  45 s). Responses as today: 200 `{ enabled, vpn, vpnError }`, 504 on timeout,
  404 when gluetun is not configured. Clients should use a request timeout of at
  least 60 s.

### Error summary

| Situation                                 | Status |
|-------------------------------------------|--------|
| Bearer token missing/wrong/none configured | 401    |
| Valid token, route not allowlisted        | 403    |
| Too many failed attempts                  | 429 + `Retry-After` |
| Gluetun not configured                    | 404    |
| Reconnect did not complete in time        | 504    |

### Documentation

A short "API access" section in `README.md`: how to generate a token, the
allowlisted routes, the timeout note, and two `curl` examples:

```sh
curl -H "Authorization: Bearer $TOKEN" https://suite.example/api/gluetun
curl -X POST -m 60 -H "Authorization: Bearer $TOKEN" https://suite.example/api/gluetun/reconnect
```

No client-specific instructions.

## Testing

New `server/test/api-token.test.js`, using the existing test helpers:

- Generating a token returns it once; the store holds a hash, not the token.
- Valid token works on `GET /gluetun` and `POST /gluetun/reconnect` without a
  CSRF header.
- Wrong token → 401; no token configured → 401.
- Valid token on a non-allowlisted route (e.g. `GET /config`) → 403.
- Regenerating invalidates the previous token; revoking → 401.
- Repeated bad tokens hit the throttle → 429.
- Cookie path unaffected: session without CSRF header still → 403 on POST.
- Token management routes reject bearer-only requests.
