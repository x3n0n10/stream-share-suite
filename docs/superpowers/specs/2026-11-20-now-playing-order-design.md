# Now playing: stable order — design

A small change: one sort in the Overview page.

## Why
The "Now playing" table on the Overview page reshuffles between refreshes,
which makes it hard to follow. Rows should stay in place.

## Cause
`web/src/pages/Overview.jsx` sorts only by `viewer_count`. Most streams have
one viewer, so they tie, and ties keep the instance's order — which is random,
because stream-share builds its list by iterating a Go map
(`SessionManager.GetAllStreams`).

## Goals / non-goals
- Goal: a row never moves while its stream keeps playing (including when
  viewers join or leave); new streams append at the bottom.
- Non-goal: changing stream-share. Each `/status` summary item already carries
  `started_at` (`activeStreamItem.StartedAt`).

## Approaches
1. **Oldest first by `started_at` (picked by the user).** Rows stay put.
2. Newest first — every new stream shifts all rows down. Not chosen.
3. Viewer count first, `started_at` as tiebreak — rows still jump when a
   viewer joins or leaves. Dropped (my call).

## Design
- A pure `sortNowPlaying(rows)` in `web/src/lib/` (same pattern as
  `sortShares` in `web/src/lib/shareLinks.js`), called from Overview.jsx in
  place of the current `.sort`.
- Order: `started_at` ascending, then `instanceId`, then `stream_id`, so equal
  timestamps stay deterministic. Viewer count no longer affects order.
- Parse `started_at` once per row (`Date.parse`, `Infinity` when missing), not
  inside the comparator; `Infinity` also puts streams without a start time
  last. Don't compare raw strings: Go's RFC3339Nano trims trailing zeros, so
  string order can be wrong.
- Test in `web/test/` (node `--test`, like `shareLinks.test.js`): oldest
  first, tiebreaks, missing `started_at` last, and same output regardless of
  input order.
