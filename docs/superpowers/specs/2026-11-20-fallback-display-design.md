# Fallback viewings: one row per real viewing

## Intent

When an instance (instance A) cannot start a live channel itself, because its
provider fails or every connection is in use, it borrows a connection from a
fallback instance (instance B). Both instances then report the same viewing:

- A reports the stream with `via: "B"` and the real viewer.
- B reports its own copy of the stream, under its own provider's title
  (so the same channel can carry two different titles), with a stand-in viewer
  named `failover:A/<n>`, shown today as "Through A".

So one person watching takes up two rows in Now playing, adds 2 to the
active-streams badge, appears twice in History, and adds "Through A" rows
to Top viewers plus a phantom title to Top titles. The two rows don't even
share a title, so nobody can tell they are the same viewing. The only hint
on the real row is a grey "via B" that looks just like the channel id.

The owner wants **one row per real viewing**, with the borrowing made clear on
that row. The instance cards under Now playing are where connection use per
instance is shown, so the lender's copy does not need its own row.

## Goals

- Overview Now playing: one row per real viewing. The borrowed viewing is
  clearly marked as using the fallback's connection.
- Active-streams badge counts real viewings only.
- History: one row per real viewing, marked the same way in past tense.
- Leaderboard: no "Through X" viewers, and borrowed viewings are counted once
  (no phantom titles, no double-counted watch time or views).

## Non-goals

- The connection bar on the instance cards, which no longer always matches
  the connections in use since failover arrived. The owner called that a
  separate matter.
- Catchup and VOD, which never use a fallback.
- Fallback marking on the Leaderboard: those are totals, not viewings.

## Anti-goals

- A lender's own household viewer disappearing. If someone on B watches
  the same channel A borrows, B's row stays (only the "Through A"
  chip goes).
- Claiming a reason the Suite cannot know. Failover happens on a provider
  failure as well as at the connection limit, so the marking never says
  "at its limit".

## Approaches

| | Approach | Trade-off |
|---|---|---|
| A | Suite only: filter lent rows, lent viewers and Through rows; count the badge itself | Works on any instance version, but Top titles stays wrong: instances send it already aggregated, so the Suite cannot subtract the lent viewing |
| B | stream-share only: instances leave lent viewers out of counts, history and top lists | Correct at the source, but needs a release and image upgrade everywhere; un-upgraded instances keep showing duplicates |
| **C** | **Both (picked):** the Suite does all of A; stream-share leaves lent viewers out of its aggregated stats, the one thing the Suite cannot fix | Correct immediately on any version for everything except Top titles; Top titles is right once the lender runs the new version. A lender already needs a recent version for failover, so this is a small step |

The owner picked C.

## Design

A lent viewer is any username/viewer id matching `failover:<instance>/<n>`;
today `lentTo()` in `web/src/lib/failover.js` detects it. Upstream has
`session.IsFailoverIdentity` / `FailoverIdentityPrefix`.

### Suite server: one lent-viewer rule (`server/src/routes/ops.js`)

All filtering happens once, on the Suite server, on data it already fetches,
so the pages only render. A small helper (next to the other failover code in
`server/src/reconcile/failover.js`, mirroring `lentTo()`'s
`failover:<instance>/<n>` pattern) is used by four routes:

- `/overview`: in each instance's `status.summary`, drop lent viewers from a
  stream's `viewers`, and drop the stream entirely when it had viewers and all
  were lent. A stream that keeps a real viewer stays, minus the lent ones. When
  an instance reports no `viewers` list (older versions), leave it as is. The
  instance cards read `stats`/`streams_count`, not `summary`, so they are
  unaffected.
- `/active-streams`: count the streams left after that same rule, instead of
  summing `streams_count` (which includes lent streams). Same `/status` call
  as today, no extra requests.
- `/history`: drop entries whose username is lent, before the merged feed is
  cut to `limit`, so the page is never short.
- `/leaderboard`: drop lent `top_users` before the top-10 cut, so the list
  stays full on un-upgraded instances.

### Suite pages

- Remove every "Through X" label and the `lentTo()` calls in Overview,
  History and Leaderboard (the server no longer sends lent viewers). Drop
  `lentTo()` from `web/src/lib/failover.js` if nothing else uses it.
- Overview Now playing: rows with `via` get the option C marking (chosen from
  mockups): an amber inset left edge on the row and an amber line under the
  title, `Using <via>'s connection`, replacing today's grey "via X". The
  `TechSummary` line stays.
- History: rows with `via` get the same edge and line in past tense,
  `Used <via>'s connection`. The search box also matches `e.via`.
- Leaderboard: no visible change beyond the Through rows going away.

### stream-share (`pkg/database/stream_history.go`)

- `GetTopTitles`, `GetTopUsers` and `GetWatchStats` exclude rows whose
  username starts with `failover:` (use `FailoverIdentityPrefix`'s value; the
  database package must not import `session` if that creates a cycle, so a
  local constant with a comment pointing at it is fine).
- History and the live status keep returning lent viewers: the Suite filters
  them, and instance cards still need to see the connection in use.
- Ship in a stream-share release; the Suite needs no version check because
  its own filtering already covers everything except Top titles.

### Tests

- Server: the helper on a lent-only stream, a mixed stream, a normal stream
  and a stream with no `viewers` list; `/active-streams` count; `/history` and
  `/leaderboard` drop lent rows before the cut.
- stream-share: top titles/users/watch stats ignore `failover:` rows.

## Known edge, accepted

If the borrowing instance cannot be reached while the lender can, the
lender's lent-only row is dropped and that viewing briefly shows nowhere.
Rare and short-lived; no code for it (builder's call).

## Left to the builder

- Exact Tailwind classes for the amber edge and line, matching the Suite's
  existing amber tones in light and dark mode.
- Whether the marking helper is a tiny shared component or inline in both
  pages.
- Docs: a line in `docs/instances.md` under Failover about how borrowed
  viewings show up.
