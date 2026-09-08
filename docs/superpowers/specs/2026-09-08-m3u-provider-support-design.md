# M3U provider support

## Context

Every instance the Suite provisions today requires Xtream credentials
(`xtreamBaseUrl`, `xtreamUser`, `xtreamPassword` are all `required: true`,
unconditionally, in `server/src/schema/instance.js`). `m3uUrl` exists in the
schema but only as an optional, `advanced: true` supplement — "only needed
if your provider serves a playlist separately from its Xtream API."

stream-share itself (the underlying app the Suite deploys, `x3n0n10/stream-share`)
does not share this restriction. Its own README documents a plain-M3U mode
with no Xtream fields at all (`--m3u-url` alone, no `--xtream-*` flags), and
the Suite's own dashboard code already tolerates that state gracefully —
`server/src/instanceClient.js` and `web/src/components/Subscription.jsx`
both treat "a plain-M3U deployment has no subscription at all" as an
expected, non-error condition. A pure-M3U instance can only enter the Suite
today via import/adopt of a manually-deployed container
(`reconcile/import.js` doesn't re-run the Suite's own `required` validation
on adopted containers) — neither the wizard nor Stack's own instance forms
can create one.

This spec adds that choice to instance creation itself: Xtream API or M3U
playlist, picked once per instance.

## Why Xtream stays the recommended default

Xtream API mode is strictly more capable: VOD, series and EPG metadata, and
subscription status reporting (`GET /api/internal/provider`) all come
through the Xtream API. A plain-M3U deployment reports `{"configured":
false}` for subscription status — "the concept doesn't apply" — and has no
equivalent path to VOD/series/EPG metadata. M3U is for providers that
genuinely don't offer an Xtream API; it isn't a lateral choice. The UI
default and copy reflect that.

## What upstream actually models (and what it doesn't)

Confirmed against stream-share's own README before designing this, because
guessing the wrong shape here would ship something that doesn't map to real
CLI flags:

- `--xtream-base-url` / `--xtream-user` / `--xtream-password`: three
  separate flags, Xtream mode only. Already modeled 1:1 by the existing
  schema fields.
- `--m3u-url`: **one** opaque URL string. It may itself embed a query-string
  username/password (`get.php?username=...&password=...`), but that's
  provider-specific and not something stream-share (or the Suite) parses out
  into separate fields. There is no `--m3u-user` / `--m3u-password`
  equivalent to `--xtream-user` / `--xtream-password`.
- `--auth-user` / `--auth-password`: a third, independent pair — the
  *viewer's* login to the Suite-hosted proxy. Always typed explicitly by the
  operator regardless of upstream mode; already modeled as `authUser`/
  `authPassword` in the `Access` group.

Consequence: the wizard's "Use my provider credentials" sign-in convenience
(copies `xtreamUser`/`xtreamPassword` into `authUser`/`authPassword`) has
nothing to copy in M3U mode, because there is no separate provider login
pair in M3U mode to copy from. It's hidden rather than backed by an invented
field, since inventing one wouldn't correspond to anything upstream reads.

## Schema change

`server/src/schema/instance.js`, `Provider` group:

```js
{
  key: "providerType",
  envVar: null,               // Suite-side branching only; nothing upstream reads it
  label: "Playlist source",
  type: "select",
  options: ["xtream", "m3u"],
  default: "xtream",
  group: "Provider",
  required: true,
},
```

Placed first in the `Provider` group, ahead of `xtreamBaseUrl`.

`xtreamBaseUrl`, `xtreamUser`, `xtreamPassword` each gain:

```js
dependsOn: { key: "providerType", equals: "xtream" },
```

`m3uUrl` loses `advanced: true` and gains:

```js
required: true,
requiredWhen: { key: "providerType", equals: "m3u" },
```

— staying visible (not gated by `dependsOn`) in both modes, since an Xtream
provider that also serves a supplementary M3U feed is real, existing,
supported behavior today. Only its *mandatoriness* is conditional.

This is the same `dependsOn`/`requiredWhen` mechanism already in production
for gluetun's `vpnType` (wireguard vs. openvpn) and documented in
`registry.js`'s own comments as built for exactly this shape — "a field can
be relevant in every mode and yet only mandatory in one." `validate()`
already skips `required` checks for fields hidden by `dependsOn`
(`registry.js:81-86`), and `renderEnv()` already omits hidden fields from
the container's env entirely (`registry.js:108-122`) — so an M3U-mode
instance's container spec simply never gets `XTREAM_*` vars, no extra code
needed.

`default: "xtream"` on the new field means every existing or freshly-imported
instance (no `providerType` key in its stored `config_json`) resolves to
`"xtream"` via `resolvedValue()`'s existing default-fallback — zero
migration, zero behavior change for anything that exists today.

## What needs code, and what doesn't

`SchemaForm` (`web/src/components/SchemaForm.jsx`) already renders
`dependsOn`-gated fields generically. That means every surface driven
through it needs **no changes**:

- Stack's own "Add instance" form (`InstancesCard` in `Stack.jsx`) — schema-driven already.
- Stack's instance edit form — schema-driven already.
- The wizard's own instance edit form (`StepInstances.jsx`'s `editFields`,
  filtered to `EDIT_GROUPS = ["Instance", "Provider", "Access"]`) — the
  `Provider` group already includes `providerType`/`m3uUrl`, no change to
  `EDIT_GROUPS` needed.

Known limitation this inherits rather than introduces: `SchemaForm`'s
generic `<select>` rendering shows each option's raw value as its own
label (`<option value={opt}>{opt}</option>` — see `renderControl`), so
Stack's generic forms will show a plain "xtream"/"m3u" dropdown rather
than the wizard's polished "Xtream API (recommended)"/"M3U playlist"
toggle. `authMode`'s existing "basic"/"ldap" dropdown already has this
same rough edge today — not a regression, not fixed here. A `select`
field gaining an optional label map is a reasonable future polish item,
out of scope for this spec.

Only the wizard's **add-instance** form is bespoke, hand-rolled JSX (not
schema-driven) — `StepInstances.jsx`'s `adding` block, `blankDraft()`,
`toPatch()`. That's the one real UI surface this spec touches.

## Wizard add-form changes (`StepInstances.jsx`)

- New segmented toggle above the Provider fields, same visual pattern as
  the existing "How users sign in" button row: **"Xtream API
  (recommended)"** / **"M3U playlist"**. Defaults to Xtream (matches the
  schema default).
- A one-line note under the toggle, switching with the selection — e.g.
  under M3U: *"Xtream unlocks VOD, series, EPG and subscription status;
  pick this only if your provider doesn't offer an Xtream API."*
- Xtream selected: today's three fields (base URL, username, password),
  unchanged.
- M3U selected: single "M3U playlist URL" field in their place.
- `blankDraft()` gains `providerType: "xtream"` and `m3uUrl: ""`.
- `toPatch()` includes `providerType` always; includes the three Xtream
  fields when `providerType === "xtream"`, `m3uUrl` when `"m3u"`.
- `ACCESS_MODES`' "Use my provider credentials" button is filtered out of
  the rendered row when `providerType === "m3u"`. If an operator had it
  selected and then switches to M3U, `accessMode` auto-resets to
  `"custom"` — never submits a `toPatch()` that references credentials
  that no longer exist in the draft.

## Out of scope

- Settings' Instances block (already removed this session) and its
  underlying externally-configured-instance path — unaffected, unrelated
  data model.
- Parsing a username/password out of an M3U URL's own query string —
  provider-specific, not something stream-share does either.
- Any change to `reconcile/import.js` — adopted containers already recover
  whichever of `XTREAM_*`/`M3U_URL` are actually present in their real
  environment via `valuesFromEnv()`, independent of this spec.

## Testing

- `server/test/`: schema validation tests for `providerType` — Xtream mode
  requires the three Xtream fields and not `m3uUrl`; M3U mode requires only
  `m3uUrl`; an instance with no `providerType` stored at all validates as
  Xtream (default-fallback). `renderEnv()` never emits `XTREAM_*` for an
  M3U-mode instance, and never emits `M3U_URL` for a pure-Xtream one (blank
  `m3uUrl`).
- Manual: wizard add-flow in both modes; Stack's add/edit in both modes
  (schema-driven, should work with no code changes — verify that claim
  holds); switching an existing Xtream instance to M3U via edit and back.
