# Health check: channel picker for the probe stream ID

## Problem

The setup wizard's health-check step (`web/src/pages/setup/StepHealthCheck.jsx`)
asks the operator for a "Probe channel id" per instance — a raw Xtream
`stream_id` with no help finding one. Today the only path is knowing it
already. The natural workaround (finish the wizard, run the stack, connect a
client, play a channel, read the container logs for the ID stream-share logs
at INFO level when a channel is joined) requires building a container log
viewer from scratch — the Suite has no such feature today — and forces the
operator to abandon the wizard mid-flow, go operate a player, then come back.

stream-share already builds an id → channel name index automatically at
startup, with no client needed: `warmChannelNameIndex` (`pkg/server/
server.go:385`) fetches `get_live_streams` from the provider on boot, builds
`apiChannelIndex` (`pkg/server/m3u_index.go`), and persists it to a
`stream_names` Postgres table (`pkg/database/stream_names.go`). That data can
back a proper search-by-name picker instead of a workaround.

## Design

### Data flow

```
Wizard (StepHealthCheck.jsx)
  type into the "Probe channel id" field
  → Suite: GET /instances/:id/health-check/channels?q=...  (new, ops.js)
      → instanceClient.searchChannels(instance, q)          (new)
          → stream-share: GET /api/internal/channels?q=...  (new)
              → SearchStreamNames(q, limit) against stream_names table
              → [{stream_id, name}, ...], capped at 25
  ← dropdown of "name — id" matches; picking one fills the field with that id
```

No new provider calls and no new background jobs — this only reads data
stream-share already collects and persists at startup. An empty or cold index
(instance not started yet, or provider returned no names) yields no matches;
the field is a plain text input at that point, unchanged from today. Manual
entry always works — an operator who already knows their stream ID is never
blocked by this feature.

### stream-share (new)

- `GET /api/internal/channels?q=<text>` in `pkg/server/api.go`, next to
  `/vod/search`, under the same internal-API auth.
- `SearchStreamNames(query string, limit int) ([]StreamNameMatch, error)` in
  `pkg/database/stream_names.go`: matches `name` (`ILIKE '%q%'`) or `stream_id`
  (exact or prefix), `LIMIT 25`, ordered by name. Empty `q` returns an empty
  result — never dumps the full table.
- Handler follows the existing `types.APIResponse` shape used by other
  `/api/internal` routes.

### Suite (new)

- `searchChannels(instance, q, { timeoutMs })` in `server/src/
  instanceClient.js`, mirroring `searchVOD`.
- `GET /instances/:id/health-check/channels?q=` in `server/src/routes/
  ops.js`, reusing `req.config.vodSearchTimeoutMs` — the same shape of call as
  VOD search, so no new timeout setting.
- `api.searchHealthCheckChannels(key, q)` in `web/src/lib/api.js`.

### UI (`StepHealthCheck.jsx`)

The per-instance text input remains the source of truth for the stored
`streamId` and stays directly editable (the fallback path). Typing debounces
(300ms) into a query against the new endpoint; matches render as a dropdown of
`name — id` below the field. Picking one fills the field with that `stream_id`
and shows the picked name as a small caption. No matches: the dropdown simply
doesn't appear — this is not an error state. Styling follows the existing
search-result list in `web/src/pages/Vod.jsx`, without its thumbnail/grouping
logic (channels are flat, unlike VOD's movie/series grouping).

### Error handling

A failed channel-search request is swallowed (console warning at most) and
never surfaces in the wizard's `ErrorNote` or blocks submission — it only
affects whether suggestions appear; the field still works as free text either
way.

### Testing

- stream-share: table test for `SearchStreamNames` (substring match on name,
  numeric-id match, limit, empty query returns nothing), plus a handler test
  for `/api/internal/channels`, following the existing `pkg/database/
  *_test.go` and handler test conventions.
- Suite: a route test for the new `ops.js` endpoint mirroring the existing
  VOD-search route test, plus a UI test for the debounce/dropdown/fallback
  behavior in `StepHealthCheck.jsx` if that component gets test coverage.

## Out of scope

- A container log viewer (the workaround this design replaces the need for).
- Any change to how `HEALTHCHECK_STREAM_ID` is consumed on the instance side
  (`pkg/server/handlers_health.go`) — this only helps find the value, not how
  it's used.
- Browsing the full channel list with no query — search only, to avoid
  dumping potentially thousands of rows into the wizard.
