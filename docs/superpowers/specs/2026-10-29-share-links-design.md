# Share links: time-limited live channel links

## Problem

StreamShare gained live share links (stream-share PR #53): a link to one live
channel that only works inside a time window. A household member makes one from
Discord with `/share` to let a guest watch a match or an event. The Suite has no
page for them. They can only be created, listed and revoked from Discord or by
calling the instance API directly.

The Suite already lets an operator create VOD download links (VOD search page).
Live share links are the missing counterpart.

## Scope

In:

- A new **Share links** page in the sidebar, for live channels only.
- Per instance: list links, create a link, revoke a link, copy a link's two
  addresses.
- Reuse of the Suite's existing "VOD actor username" setting (default `suite`)
  as the link's creator name.
- A short cross-link on the Share links page and the VOD search page pointing at
  each other.
- Docs page and README/docs index entry; server tests for the new routes.

Out (non-goals):

- **VOD links on this page.** They differ: no time window (one per-instance
  lifetime, `temp-link-hours`), and the instance API cannot list or revoke them.
  A merged page would be half empty. If stream-share later gains list/revoke for
  VOD links, the page can take them as a second tab.
- Editing an existing link (the instance API has no edit; revoke and recreate).
- Usage statistics per link, notifications, or any change to the Discord bot.
- Changes to stream-share itself.

Anti-goal: the page must never hand out an address that does not work from
outside (for example the instance's internal Docker address).

## Design

### Instance API used (stream-share, `/api/internal`, `X-API-Key` as today)

- `GET /shares` list links of all creators. Each item: `token`, `stream_id`,
  `title`, `created_by`, `guest`, `starts_at`, `ends_at`, `revoked_at`,
  `created_at`, `state` (`scheduled`, `active`, `ended`, `revoked`), `identity`,
  `urls: { playlist, stream }`. Responses use the usual
  `{ success, data }` wrapper that `callInstance` already unwraps.
- `POST /shares` body `{ username, guest, stream_id, starts_at, ends_at }`,
  times RFC 3339. Rules enforced by the instance: end after start, window at most
  24 hours, end in the future, channel must exist and not be hidden by the
  catalogue filter. Returns the created link in the list shape.
- `DELETE /shares/:token` revokes.
- `GET /shares/channels?q=` live channel search (up to 25 results:
  `stream_id`, `num`, `name`), already restricted to channels the catalogue
  filter keeps. 400 when `q` is empty.
- An instance image from before the feature answers 404 on these routes. A link
  store that is not ready answers 503.

### Server (`server/src`)

- `instanceClient.js`: four thin functions, `listShares`, `createShare`,
  `revokeShare`, `searchShareChannels`, built on `callInstance`.
- `routes/ops.js`, behind the normal session auth and CSRF (the API token
  allowlist is not extended):
  - `GET /instances/:id/shares`
  - `POST /instances/:id/shares` (body `guest`, `streamId`, `startsAt`,
    `endsAt`; `username` is filled from `req.config.vodActorUsername`)
  - `DELETE /instances/:id/shares/:token`
  - `GET /instances/:id/shares/channels?q=`
  Unknown instance gives 404 like the neighbouring routes. Instance failures go
  through the existing `failure()` helper (an instance 401/403 becomes 502, never
  a Suite logout).
- A 404 from the instance on `/shares` is translated into a clear
  "this instance does not support share links, update it" error that the page can
  recognise (a distinct `code` in the JSON error body).
- The link addresses are built on the Suite, not taken from the instance:
  `publicBaseUrl + "/share/" + token + ".m3u"` and
  `publicBaseUrl + "/share/" + token + "/live.ts"`. The instance builds its own
  from the request it sees, which from the Suite is the internal address.
  `managedInstances()` in `config.js` gains a `publicBaseUrl` field (trimmed, no
  trailing slash, empty when unset). Each list item the Suite returns carries
  `urls` (when a public base URL is known) or `paths` only (when not).

### UI (`web/src`)

- Sidebar item "Share links" (`/shares`, gated `requiresInstances` like VOD
  search), placed next to VOD search. New page `pages/ShareLinks.jsx`.
- Layout (chosen by the operator): an instance switcher on top (pills, same
  pattern as other per-instance pages; single instance means no switcher), a
  "+ New link" button on the right, and a table for the selected instance:
  channel (name, with the stream id small beside it: a list item carries
  `title` and `stream_id` but no channel number), guest, window ("Sat 20:00 to
  23:00", browser local time), state, actions. Links created from Discord by
  other people are listed too (list is not filtered by creator), and the
  operator may revoke any of them.
  - States render as a text badge: scheduled, active (emphasised), ended,
    revoked (dimmed). Ended and revoked rows have no actions.
  - Actions on scheduled and active rows: Copy playlist link, Copy stream link,
    Revoke (with a confirmation).
  - Sorting: active first, then scheduled by start time, then ended and revoked
    by end time, newest first.
  - Empty state: "No share links yet", with the New link button.
- "+ New link" dialog: channel search (reuses the debounce and stale-response
  logic of `ChannelSearchInput`, pointed at the share channel search and
  returning a stream id plus display name), optional guest label (max 40
  characters, as the instance trims it), From and Until as `datetime-local`
  inputs (From defaults to now, Until to From plus 2 hours). Client-side checks
  before submit: channel chosen, end after start, window at most 24 hours; the
  note "Longest allowed: 24 hours. Up to 3 devices can use one link at once."
  stays visible. Times are sent as ISO 8601 with the browser's offset.
  Server-side errors from the instance are shown verbatim in the dialog.
- After creating: the dialog switches to a result view showing the playlist link
  (for VLC and IPTV apps) and the direct stream link, each with a Copy button,
  then Close. Same copy helper as the VOD page.
- No public base URL known for the selected instance (instance added by hand, or
  the setting is empty): a notice states that the Suite does not know the
  instance's public address, Copy is disabled, and only the paths
  (`/share/<token>.m3u`, `/share/<token>/live.ts`) are shown for manual
  prefixing. Setting the public base URL on a Suite-managed instance fixes it.
- Instance without share support: the page shows an empty state saying so and
  suggesting an update, and hides New link.
- The list refreshes on the Suite's configured poll interval (`pollIntervalMs`,
  as the other pages do) and when the page gains focus. A row's state is also
  recomputed in the browser from its window each second-ish tick, so a link
  flips from scheduled to active to ended on time without waiting for a poll.
- Cross-links: a one-line note under the Share links title ("Need a movie or
  episode link? Use VOD search.") and under the VOD search title ("Need a live
  channel link for a time window? Use Share links.").

### Docs

- `docs/share-links.md` (what it is, creating a link, the public base URL
  requirement, limits), a row in the README documentation table, and a mention in
  `docs/instances.md` if it lists per-instance features.

### Tests (`server/test`)

Same style as `instance-channels.test.js`: a fake instance server.

- List: passes through, builds addresses from `publicBaseUrl`, falls back to
  paths when it is unset.
- Create: fills `username` from the actor setting, forwards times unchanged,
  surfaces instance validation errors with their status.
- Revoke and channel search: correct instance path and method, unknown instance
  gives 404.
- An instance 404 on `/shares` becomes the "not supported" error code.
- CSRF and session auth apply (as for the neighbouring routes).

UI is checked by hand (no component tests exist for pages today).

## Decisions taken by the builder (operator can overrule)

- Creator name reuses the existing VOD actor username setting rather than a new
  setting or a hard-coded string; default stays `suite`.
- Addresses are built from `publicBaseUrl` on the Suite. If unknown: Copy
  disabled and paths shown, rather than guessing or showing internal addresses.
- The default window of 2 hours and the "recompute state in the browser" tick
  are starting values.
- The list shows every creator's links and the operator can revoke any; the
  instance API allows this when no username is passed.
- No per-link "copy" for the VOD kind and no tabs now; revisit when stream-share
  can list VOD links.
