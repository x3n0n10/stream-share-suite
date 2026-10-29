# Share Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Share links" page in the Suite to list, create, revoke and copy time-limited live channel links on a StreamShare instance, plus cross-links with the VOD search page.

**Architecture:** Four thin routes in `server/src/routes/ops.js` proxy the instance's `/api/internal/shares*` API (client functions in `instanceClient.js`). A small `server/src/shareLinks.js` shapes responses and builds link addresses from the instance's public base URL (the instance's own `urls` are internal-facing and are never used). The page is `web/src/pages/ShareLinks.jsx` with pure logic in `web/src/lib/shareLinks.js`.

**Tech Stack:** Node 22 ESM + Express, `node:test`; React 18 + Vite + Tailwind. Run server tests with `cd server && node --test test/<file>`, web unit tests with `cd web && node --test test/<file>`, and `cd web && npm run build` for UI changes.

**Spec:** `docs/superpowers/specs/2026-10-29-share-links-design.md`

## Global Constraints

- Live channels only. No VOD links on this page, no editing of existing links, no usage statistics, no stream-share changes.
- A link lasts at most 24 hours. The dialog note reads exactly: `Longest allowed: 24 hours. Up to 3 devices can use one link at once.`
- Guest label: optional, at most 40 characters.
- Times are sent as ISO 8601 with the browser's offset (`Date#toISOString()` is fine). Default window: From = now, Until = From + 2 hours.
- Creator name sent to the instance is `req.config.vodActorUsername` (default `suite`). No new setting.
- New routes sit behind the existing session auth and CSRF. Do not touch `API_TOKEN_ROUTES`.
- Link addresses: `<publicBaseUrl>/share/<token>.m3u` (playlist) and `<publicBaseUrl>/share/<token>/live.ts` (stream). With no known public base URL, return paths only and disable Copy.
- Cross-link copy, exact: Share links page: `Need a movie or episode link? Use VOD search.` VOD search page: `Need a live channel link for a time window? Use Share links.` (each text links to the other page).
- Follow existing styling: Tailwind classes as in `Vod.jsx`, `FIELD` from `components/common.jsx`, `ErrorNote`, `EmptyState`, `Button`, `ConfirmDialog`, `Badge`.

## Review Focus

- Token containing `-` and `_` (base64url) in the revoke path: must be URL-encoded and reach the instance intact. (Task 2)
- Instance 404 on revoke ("unknown share link") must not be mistaken for "shares unsupported". (Task 2)
- Instance rejects a window the browser accepted (clock skew, "window is already over"): its message shows verbatim in the dialog. (Tasks 2, 5)
- Window crossing midnight or a DST change: display and validation use real timestamps, not wall-clock arithmetic. (Task 3)
- One instance down or old: only that instance's tab shows the error or "update" notice; the page and other instances keep working. (Task 5)

---

### Task 1: Share shaping and public base URL

**Files:**
- Create: `server/src/shareLinks.js`
- Modify: `server/src/config.js` (`managedInstances()`, around line 72-92)
- Test: `server/test/share-links.test.js`

**Interfaces:**
- Produces:
  - `shareAddresses(publicBaseUrl: string | undefined, token: string): { paths: { playlist: string, stream: string }, urls: { playlist: string, stream: string } | null }`
  - `shapeShare(raw: object, publicBaseUrl: string | undefined): Share` where `Share` is `{ token, streamId, title, createdBy, guest, startsAt, endsAt, revokedAt, createdAt, state, paths, urls }` (camelCase of the instance's `snake_case` fields; `guest` defaults to `""`, `revokedAt` to `null`; `startsAt`/`endsAt`/`createdAt` stay RFC 3339 strings; `state` is passed through).
  - Each managed instance object in `loadConfig().instances` gains `publicBaseUrl: string` (trimmed, trailing slashes removed, `""` when unset). Hand-added instances have no such field.

- [ ] **Step 1: Write the failing tests** in `server/test/share-links.test.js`
  - `shareAddresses("https://tv.example.com/", "tok")` deep-equals `{ paths: { playlist: "/share/tok.m3u", stream: "/share/tok/live.ts" }, urls: { playlist: "https://tv.example.com/share/tok.m3u", stream: "https://tv.example.com/share/tok/live.ts" } }`.
  - `shareAddresses("", "tok").urls === null` and `shareAddresses(undefined, "tok").urls === null`, paths unchanged.
  - `shapeShare({ token: "tok", stream_id: "42", title: "Eurosport 1", created_by: "discord-user", starts_at: "2026-10-31T20:00:00Z", ends_at: "2026-10-31T23:00:00Z", created_at: "2026-10-30T09:00:00Z", state: "scheduled", urls: { playlist: "http://internal:8080/share/tok.m3u" } }, "")` returns `guest: ""`, `revokedAt: null`, `urls: null`, and does **not** carry the instance's internal `urls`.
  - Config projection: with `freshDatabase()`, a managed instance provisioned as in `server/test/ops-health-check-channels.test.js` (`addManagedInstance`) and `publicBaseUrl: "https://tv.example.com//"` saved in its component values, `loadConfig().instances` has that instance with `publicBaseUrl === "https://tv.example.com"`.

- [ ] **Step 2: Run to verify failure**

Run: `cd server && node --test test/share-links.test.js`
Expected: FAIL (module `../src/shareLinks.js` not found).

- [ ] **Step 3: Implement** both functions in `server/src/shareLinks.js` and add `publicBaseUrl` to the object returned by `managedInstances()` in `server/src/config.js` (`String(values.publicBaseUrl || "").trim().replace(/\/+$/, "")`). Tokens are base64url, so no encoding in the paths.

- [ ] **Step 4: Run to verify pass**

Run: `cd server && node --test test/share-links.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/shareLinks.js server/src/config.js server/test/share-links.test.js
git commit -m "Share links: shape instance shares and build public addresses"
```

### Task 2: Instance client and routes

**Files:**
- Modify: `server/src/instanceClient.js` (after `createVODDownload`, ~line 156)
- Modify: `server/src/routes/ops.js` (imports; routes after the `/instances/:id/vod/download` route)
- Test: `server/test/ops-share-links.test.js`

**Interfaces:**
- Consumes: `shapeShare`, `shareAddresses` from Task 1; `callInstance`, `findInstance`, `timeouts`, `failure` already in these files.
- Produces (`instanceClient.js`, all `{ timeoutMs }` as last arg like neighbours, return the instance's unwrapped `data`):
  - `listShares(instance, opts)` → `GET /shares`
  - `createShare(instance, { username, guest, streamId, startsAt, endsAt }, opts)` → `POST /shares` body `{ username, guest, stream_id, starts_at, ends_at }` (omit `starts_at` when undefined)
  - `revokeShare(instance, token, opts)` → `DELETE /shares/<encodeURIComponent(token)>`
  - `searchShareChannels(instance, query, opts)` → `GET /shares/channels?q=`
- Produces (HTTP, Suite API, session + CSRF):
  - `GET /api/instances/:id/shares` → `{ shares: Share[], publicBaseUrl: string | null }`. An instance 404 here becomes status `501` with body `{ error: "This instance does not support share links. Update it to a newer image.", code: "shares_unsupported" }`. Other failures go through `failure()`.
  - `POST /api/instances/:id/shares` body `{ guest?, streamId, startsAt?, endsAt }` → the created `Share`. 400 when `streamId` or `endsAt` is missing, with no instance call. `username` comes from `req.config.vodActorUsername`.
  - `DELETE /api/instances/:id/shares/:token` → the revoked `Share` (state `revoked`).
  - `GET /api/instances/:id/shares/channels?q=` → `{ results: [{ streamId, num, name }] }`; empty `q` returns `{ results: [] }` without calling the instance.
  - Unknown instance id → 404 `{ error: "Unknown instance" }` on all four.

- [ ] **Step 1: Write the failing tests** in `server/test/ops-share-links.test.js`, same harness as `server/test/ops-health-check-channels.test.js` (fake instance server that records `method`, `url`, `headers`, parsed `body` and replies with `nextResponse`; its `addInstance()` and `addManagedInstance()` helpers). Tests, by name:
  - `list shapes shares and returns paths only for a hand-added instance`: fake replies `{ success: true, data: [rawShare] }`; response `shares[0]` equals the Task 1 shape with `urls: null`, `publicBaseUrl: null`; fake saw `GET /api/internal/shares` with `x-api-key: k`.
  - `list builds public addresses for a managed instance with a public base URL` (`publicBaseUrl: "https://tv.example.com/"`): `shares[0].urls.stream === "https://tv.example.com/share/tok/live.ts"`, response `publicBaseUrl === "https://tv.example.com"`.
  - `list turns an instance 404 into 501 shares_unsupported`: `res.status === 501`, `res.body.code === "shares_unsupported"`.
  - `list reports an instance failure as 502 with its message`: fake replies 503 `share links unavailable`; `res.status === 502`, `res.body.error` contains that text.
  - `create fills username from the actor setting and forwards times`: first with the default (`body.username === "suite"`), then after `setSetting("general.vod_actor_username", "cinema")` (`"cinema"`); `body` deep-equals `{ username, guest: "Bert", stream_id: "42", starts_at: "2026-10-31T20:00:00.000Z", ends_at: "2026-10-31T23:00:00.000Z" }`; response is a shaped `Share`.
  - `create rejects a missing streamId or endsAt with 400 and no instance call`.
  - `create surfaces an instance validation error verbatim`: fake replies 400 `a share link may last at most 24h0m0s`; same status and message.
  - `revoke URL-encodes the token and returns the revoked share`: token `a-b_c`; fake saw `DELETE /api/internal/shares/a-b_c`; response `state === "revoked"`.
  - `revoke passes an instance 404 through without the unsupported code`: `res.status === 404`, `res.body.code === undefined`.
  - `channels maps results and skips the instance for an empty query`: fake saw `GET /api/internal/shares/channels?q=eurosport`; results `[{ streamId: "412", num: "412", name: "Eurosport 1" }]`; empty `q` yields `{ results: [] }` and no new request.
  - `all four routes 404 for an unknown instance`; `unauthenticated GET shares is 401`; `POST without the CSRF header is 403` (use `client.dropCsrf()`).

- [ ] **Step 2: Run to verify failure**

Run: `cd server && node --test test/ops-share-links.test.js`
Expected: FAIL (routes return 404 from Express).

- [ ] **Step 3: Implement** the four client functions and four routes with the signatures above. Reuse `failure(res, err)`; only the list route special-cases `err.status === 404`.

- [ ] **Step 4: Run to verify pass**

Run: `cd server && node --test test/ops-share-links.test.js && node --test "test/*.test.js"`
Expected: PASS, whole server suite still green.

- [ ] **Step 5: Commit**

```bash
git add server/src/instanceClient.js server/src/routes/ops.js server/test/ops-share-links.test.js
git commit -m "Share links: instance client and routes"
```

### Task 3: Share logic helpers (web)

**Files:**
- Create: `web/src/lib/shareLinks.js`
- Test: `web/test/shareLinks.test.js`

**Interfaces:**
- Produces (all pure; `now` is a `Date` or epoch ms, `share` is the Task 1 `Share`):
  - `shareState(share, now): "scheduled" | "active" | "ended" | "revoked"` — revoked wins; window is `[startsAt, endsAt)`.
  - `sortShares(shares, now): Share[]` (new array) — active first; then scheduled by `startsAt` ascending; then ended and revoked by `endsAt` descending.
  - `MAX_WINDOW_MS` = 24 hours in ms.
  - `defaultWindow(now): { startsAt: Date, endsAt: Date }` — now and now + 2 hours.
  - `validateWindow(startsAt: Date, endsAt: Date, now): string | null` — messages: `Pick a start and an end time.` (invalid dates), `The end must be after the start.`, `A share link may last at most 24 hours.`, `The window is already over.`; `null` when valid.
  - `toDatetimeLocal(date: Date): string` — `YYYY-MM-DDTHH:mm` in local time, the value format of `<input type="datetime-local">`.
  - `formatWindow(startsAt: Date, endsAt: Date): string` — local time, `Sat 20:00 to 23:00`; when the end falls on another local day, `Sat 22:00 to Sun 01:00`. Weekday names from a fixed English array (no `Intl`), so output does not depend on the viewer's locale.

- [ ] **Step 1: Write the failing tests** using local-time `new Date(2026, 9, 31, 20, 0)` constructors (31 Oct 2026 is a Saturday) so they pass in any timezone:
  - `shareState`: revoked share inside its window is `revoked`; before start `scheduled`; exactly at `startsAt` `active`; exactly at `endsAt` `ended`.
  - `sortShares` orders `[ended, scheduled-later, active, scheduled-sooner, revoked]` as `[active, scheduled-sooner, scheduled-later, <ended/revoked newest end first>]` and does not mutate its input.
  - `validateWindow`: invalid date, end = start, end before start, 24 h + 1 ms, end in the past each return their message; exactly 24 h and a normal 3 h window return `null`.
  - `defaultWindow(now).endsAt - startsAt === 2 * 60 * 60 * 1000`.
  - `toDatetimeLocal(new Date(2026, 9, 31, 9, 5))` is `2026-10-31T09:05`.
  - `formatWindow` gives `Sat 20:00 to 23:00` and `Sat 22:00 to Sun 01:00`.

- [ ] **Step 2: Run to verify failure**

Run: `cd web && node --test test/shareLinks.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** the six functions and the constant in `web/src/lib/shareLinks.js`.

- [ ] **Step 4: Run to verify pass**

Run: `cd web && npm test`
Expected: PASS (including the existing `listItems` tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/shareLinks.js web/test/shareLinks.test.js
git commit -m "Share links: window, state and sorting helpers"
```

### Task 4: API client and generalised channel picker (web)

**Files:**
- Modify: `web/src/lib/api.js` (after `vodDownload`, ~line 147)
- Modify: `web/src/components/ChannelSearchInput.jsx`
- Create: `web/src/lib/clipboard.js`
- Modify: `web/src/pages/Vod.jsx` (replace its local `copyToClipboard` with an import)

**Interfaces:**
- Produces in `api`: `shares(instanceId)`, `createShare(instanceId, { guest, streamId, startsAt, endsAt })`, `revokeShare(instanceId, token)`, `shareChannels(instanceId, q)` — thin wrappers over the Task 2 routes (`get`, `post`, `del` already exist in this file; `token` goes through `encodeURIComponent`).
- Produces: `copyToClipboard(text: string): Promise<void>` exported from `web/src/lib/clipboard.js` (moved verbatim from `Vod.jsx`).
- `ChannelSearchInput` gains three optional props; with none given it behaves exactly as today (health-check wizard and Stack form unchanged):
  - `search(query: string): Promise<Array<{ id: string, name: string, category?: string }>>` — default calls `api.healthCheckChannels(instanceKey, query)` and maps `{ StreamID, Name, Category }` to that shape.
  - `pickValue(match): string` — text put in the input on pick; default ``${match.id}.ts``.
  - `onPick(match): void` — called after a pick, in addition to `onChange`.
  - Suggestion rows render `match.category ? ``${match.category} — `` : ""` + `match.name` and, small, `match.id`.

- [ ] **Step 1: Implement** the api wrappers, extract `copyToClipboard`, and add the three props to `ChannelSearchInput` (keep the existing debounce, stale-response guard and dismiss logic untouched).

- [ ] **Step 2: Verify** nothing regressed

Run: `cd web && npm run build && npm test`
Expected: build succeeds, tests pass. Manually (dev server, `cd web && npm run dev`): open the setup wizard's health-check step and the Stack instance form; typing a channel name still suggests channels and a pick still fills `<id>.ts`.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/api.js web/src/lib/clipboard.js web/src/components/ChannelSearchInput.jsx web/src/pages/Vod.jsx
git commit -m "Share links: api wrappers, shared clipboard helper, reusable channel picker"
```

### Task 5: Share links page (web)

**Files:**
- Create: `web/src/pages/ShareLinks.jsx`
- Create: `web/src/pages/shareLinks/NewShareDialog.jsx`
- Modify: `web/src/App.jsx` (route `/shares`, next to `/vod`, passing `pollIntervalMs`)
- Modify: `web/src/components/Layout.jsx` (`NAV_ITEMS`: `{ to: "/shares", label: "Share links", icon: IconGlobe, requiresInstances: true }` right after VOD search)
- Modify: `web/src/pages/Vod.jsx` (cross-link note)

**Interfaces:**
- Consumes: Task 3 helpers, Task 4 `api.*`, `copyToClipboard`, `ChannelSearchInput` props, `usePolling(fetcher, intervalMs, deps)`, `useConfig().instances` (`{ id, name }`).
- `ShareLinks({ pollIntervalMs })` default export, wrapped in `<Layout title="Share links">`.
- `NewShareDialog({ open, instance, onClose, onCreated })`: `instance` is `{ id, name }`; `onCreated(share)` fires after a successful create. The result view reads addresses from the created `Share` (`urls`, or `paths` when `urls` is `null`).

Behaviour (the spec's UI section is authoritative; this fixes the choices it leaves open):

- [ ] **Step 1: Implement the page.**
  - Cross-link line under the title (exact copy in Global Constraints, `Link` to `/vod`).
  - Instance pills on top (hidden with a single instance), selection in component state, default the first instance; "+ New link" button on the right (hidden when the instance is unsupported).
  - `usePolling(() => api.shares(instance.id), pollIntervalMs, [instance.id])` plus a `window` `focus` listener calling `refresh()`. A separate 5 000 ms `setInterval` updates a `now` state; `shareState`/`sortShares` always use that `now`.
  - Table columns: Channel (`title`, small `streamId` beside it, truncated), For (`guest` or `-`), Window (`formatWindow`), State (`Badge`: active emphasised, scheduled, ended and revoked dimmed), Actions. Actions only for scheduled and active: Copy playlist link, Copy stream link (each shows a check icon for 2 s after copy), Revoke via `ConfirmDialog` (`Revoke this link?`), then `api.revokeShare` and a refresh.
  - No public base URL for the instance (`urls === null`): a notice above the table (`The Suite does not know this instance's public address, so it cannot build copyable links. Set the public base URL on the instance (Stack page) to enable Copy.`), Copy buttons disabled, and the two paths shown in the row instead.
  - Error `body.code === "shares_unsupported"`: `EmptyState` titled `This instance does not support share links` with the subtitle `Update it to a newer image and reload.`; any other error: `ErrorNote`, keeping the last data like other pages.
  - Empty list: `EmptyState` `No share links yet` with the New link button.
- [ ] **Step 2: Implement `NewShareDialog`.**
  - Fields: channel (`ChannelSearchInput` with `instanceKey={instance.id}`, `search` calling `api.shareChannels` and mapping `{ streamId, num, name }` to `{ id: streamId, name, category: undefined }`, `pickValue={(m) => m.name}`, `onPick` storing `{ streamId, name }`; editing the text afterwards clears the stored `streamId`), guest (`maxLength={40}`), From and Until (`datetime-local`, initialised from `defaultWindow(now)` via `toDatetimeLocal`), the exact note from Global Constraints.
  - Submit disabled until a channel is picked; `validateWindow(new Date(from), new Date(until), Date.now())` message shown inline; submit sends `api.createShare(instance.id, { guest, streamId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() })`. An API error message is shown verbatim above the buttons and the dialog stays open.
  - Result view after success: the playlist link (`for VLC and IPTV apps`) and the stream link, each with Copy (or the paths with a disabled Copy when the share's `urls` is `null`), then Close; closing calls `onCreated` first so the list refreshes.
- [ ] **Step 3: Wire the route, nav item and the VOD page note** (exact copy in Global Constraints, `Link` to `/shares`).
- [ ] **Step 4: Verify**

Run: `cd web && npm run build`
Expected: build succeeds.
Manual check against a stream-share instance (dev server with the Suite server running, or the Docker image): create a link for a channel in a window starting in 1 minute, see `scheduled` flip to `active` without reloading, copy both links, open the playlist link outside the Suite, revoke the link and see it dimmed; then repeat with an instance that has no public base URL (Copy disabled, paths shown) and with an older instance image (unsupported empty state).

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "Share links: page, new-link dialog, navigation and cross-links"
```

### Task 6: Docs

**Files:**
- Create: `docs/share-links.md`
- Modify: `README.md` (documentation table, add a row after `Instances`)
- Modify: `docs/dashboard.md` (page table, add a row after `VOD search`)

- [ ] **Step 1: Write `docs/share-links.md`** in the voice of the neighbouring docs (`docs/instances.md`, `docs/dashboard.md`): what a share link is, creating one (channel search, optional guest label, window), what the guest receives (playlist link for VLC and IPTV apps, direct stream link), limits (24 hours maximum, 3 devices per link at once), revoking, why Copy can be disabled (public base URL must be set on the instance) and the "update this instance" notice, and a pointer to VOD search for movie and episode links.
- [ ] **Step 2: Add the README row** `| [Share links](docs/share-links.md) | Create, copy and revoke time-limited live channel links |` and the `docs/dashboard.md` row `| **Share links** | Create time-limited links to one live channel for a guest. See [share links](share-links.md) |`; add "Share links" to the sentence listing pages that appear once an instance exists.
- [ ] **Step 3: Verify** links resolve

Run: `grep -n "share-links" README.md docs/dashboard.md`
Expected: one hit per file; `docs/share-links.md` exists.

- [ ] **Step 4: Commit**

```bash
git add docs/share-links.md README.md docs/dashboard.md
git commit -m "docs: describe the Share links page"
```
