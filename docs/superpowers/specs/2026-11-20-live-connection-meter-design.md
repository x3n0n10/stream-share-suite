# Connection meter that adds up: trust the live count

## Intent

Each instance block shows provider connections as a caption ("X of Y
connections in use · Z here") and a meter. Since failover, these often
don't add up. A real case, two streams playing, one borrowed from instance B:

- Instance A: "0 of 1 connections in use · 2 here", empty bar.
- Instance B: "0 of 1 connections in use · 1 here", empty bar.

Both instances were at their limit. The bars should have been full, with
A at "1 of 1 · 1 here" and B at "1 of 1 · 1 here".

Three causes:

1. **"Here" counts borrowed streams.** stream-share's
   `local_upstream_connections` counts every active stream, including one
   served through a fallback (`via` set), which uses the fallback's connection,
   not this instance's.
2. **The provider total is stale.** `active_connections` is the provider's
   account figure, cached and re-read every 15 minutes by default. "Here" is
   live, so they drift apart whenever streams start or stop.
3. **The meter hides live use.** It caps "here" at the provider total, so a
   stale total of 0 draws an empty bar while the instance is at its limit.

## Goals

- "Here" means connections to this instance's own provider, live.
- The caption and meter never show less use than the live count.
- Use on other devices of the same account (the provider total minus "here")
  still shows, once the provider total catches up.

## Non-goals

- More frequent provider reads (approaches B and C, not chosen).
- Any change to the stream/viewer counts on the block.

## Approaches

| | Approach | Trade-off |
|---|---|---|
| **A** | **Trust the live count (picked):** stream-share leaves fallback-served streams out of "here"; the Suite uses the higher of provider total and "here" | No extra provider traffic; "elsewhere" use still lags up to the refresh interval |
| B | Re-read provider info on every stream start/stop | Exact provider numbers, but a provider call per channel change, which the code deliberately avoids; some providers lag anyway |
| C | A plus a 5-minute default refresh | "Elsewhere" shows sooner, at three times the provider reads |

The owner picked A.

## Design

### stream-share (`pkg/server/handlers_provider.go`)

`activeStreamCount()` skips streams whose `GetVia()` is not empty. A lent
stream on the lender has no `via`, so it still counts there, which is correct:
it uses the lender's connection. Test: a session manager with one own stream
and one `via` stream reports 1.

### Suite (`web/src/components/Subscription.jsx`)

One rule, used by the caption (`connectionsText`), the meter
(`ConnectionMeter`) and the Instances detail (`SubscriptionDetail`'s
Connections fact): `used = max(active_connections ?? 0, local_upstream_connections ?? 0)`.

- Caption: `${used} of ${max} connections in use · ${here} here`.
- Meter: unchanged otherwise, with `used` from the rule; "elsewhere" is
  `used - here`. Severity (accent / amber at the limit / rose over it)
  follows `used`.
- Detail: "`used` of `max`", sub "`here` from this instance".

Put the rule in one small helper in that file and test it in
`web/test/` (plain function, like `web/test/failover.test.js`):
provider 0 / here 2 gives 2; provider 3 / here 1 gives 3; missing fields give 0.

## Accepted consequences

- Until a borrowing instance runs the fixed stream-share, its "here" still
  counts the borrowed stream, so with the new rule it can show one over its
  limit (rose) while it borrows. Failover already needs a recent stream-share,
  so upgrading clears it.
- The max rule only corrects a provider total that is too low. One that is
  too high (another device just stopped) still shows that "elsewhere" use
  until the next provider read, up to the refresh interval. Fixing that means
  more provider reads (approaches B/C), which were not chosen.

## Left to the builder

- Helper name and where exactly it sits in `Subscription.jsx`.
- A line in `docs/instances.md` only if it already explains the meter.
