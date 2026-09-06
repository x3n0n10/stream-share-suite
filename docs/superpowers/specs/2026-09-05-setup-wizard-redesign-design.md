# Setup wizard redesign

## Context

The current Setup wizard (`web/src/pages/Setup.jsx`) walks through VPN
choice → gluetun → PostgreSQL → one instance → done. It works, but it was
built around configuring components in dependency order, not around how an
operator actually thinks about a fresh install: which providers am I
connecting, how do people access them, what infrastructure does that need.

This spec reorders and substantially expands the wizard around the
instances themselves — including features (Discord, health-checked VPN
reconnects) that exist today but aren't reachable from Setup at all.

## Scope

This is a frontend-heavy pass with two small, bounded backend additions
(Discord fields, and a per-instance cache path override — see below). It
replaces `Setup.jsx`'s contents; it does not touch the Stack page, which
remains the place to review/apply the resulting plan and to edit any of
this configuration later.

## Backend change: Discord fields

`web/src/pages/Instances.jsx` already shows a `discord_enabled` badge — a
status stream-share reports about itself — but the Suite has no way to
configure Discord on an instance today. Add a `Discord` field group to
`INSTANCE_SCHEMA` (`server/src/schema/instance.js`):

| Key | Env var | Type | Notes |
|-----|---------|------|-------|
| `discordEnabled` | — | checkbox, default false | Gates the fields below |
| `discordBotToken` | `DISCORD_BOT_TOKEN` | secret, required when enabled | |
| `discordAdminRoleId` | `DISCORD_ADMIN_ROLE_ID` | optional | |

`DISCORD_API_URL` is not a field — `reconcile/instance.js` computes it from
the instance's existing `publicBaseUrl` when `discordEnabled` is true, the
same "don't ask twice" approach already used elsewhere in that file.
Validation: `discordEnabled: true` requires `publicBaseUrl` to be set (a
`requiredWhen`-style rule, matching the pattern `postgres.js`'s
`adminPassword` already uses for `mode: "managed"`).

## Backend change: per-instance cache path override

Every instance's VOD/catchup cache lives at `<SUITE_CACHE_DIR>/<instance
name>` today (`server/src/store/paths.js`'s `componentCacheDir`) —
`SUITE_CACHE_DIR` is one shared host path for the whole Suite, set once in
compose, deliberately with no UI override (see that file's own comment: a
per-component override would previously have just meant re-declaring the
same string). This spec adds a genuine new capability on top of that,
rather than reopening that decision: an **optional** per-instance override
so a given instance's cache can live somewhere other than the shared root
— useful when, say, one provider's catchup buffer should sit on a
different disk than the rest.

Add to `INSTANCE_SCHEMA`'s existing `Container` group (alongside
`containerName`, `port` — the same "computed default, optional override"
shape those already have):

| Key | Env var | Type | Notes |
|-----|---------|------|-------|
| `cachePath` | — | text, advanced | Host path. Blank (the default) keeps today's computed `<SUITE_CACHE_DIR>/<name>` behavior. |

`reconcile/instance.js` line 88 changes from
`ensureDirectory(componentCacheDir(name))` to
`ensureDirectory(values.cachePath?.trim() || componentCacheDir(name))`.
Validated with the existing `validatePath` helper from `store/paths.js`
(already does exactly this check — absolute, exists, writable by the
Suite) wired into this instance's readiness check in
`reconcile/catalog.js`, the same way the stack-wide data/cache paths are
already checked there — so a bad override surfaces as a plan-time message,
not a container that fails to start.

No other backend changes. Auth-mode reuse, shared-caching-as-a-wizard-
convenience, Postgres managed/external, VPN, and health check are all
already fully supported by the existing schemas and settings store — this
wizard only resequences and curates access to them.

## Wizard architecture

`web/src/pages/setup/` — one file per step:

- `StepInstances.jsx`
- `StepCaching.jsx`
- `StepDatabase.jsx`
- `StepExternalAccess.jsx`
- `StepVpn.jsx`
- `StepHealthCheck.jsx`
- `StepDone.jsx`

`Setup.jsx` becomes a slim orchestrator: current step index, and the list of
instances created this run (`{ key, port, displayName }`) — later steps
(external access, health check) read and patch that list. Steps that reuse
an existing component schema (Postgres, gluetun, Caddy, and the Provider
fields of an instance) render `SchemaForm` with a **client-side filtered
subset** of `componentFields(kind)`'s result, filtered by `field.group` —
`SchemaForm` already resolves `dependsOn` conditionals generically, so
filtering by group is enough; no new API is needed. The one place this
isn't enough is the Access sub-step (see below), which needs a small
hand-built wrapper because its 3-way choice doesn't correspond to a single
real schema field.

Every step's submit follows the existing error-handling convention
(`err.body?.errors?.map(...)`, shown via `ErrorNote`). Steps that touch
multiple instances at once (caching, external access, health check) use
`Promise.allSettled` and report partial failures by instance name, the same
pattern `Aliases.jsx`'s `describeFailures` already implements for "apply to
all instances" — worth extracting that helper to `lib/` so both places use
one implementation instead of two copies.

## Step 1 — Instances (required, add-another loop)

At least one instance is required before continuing — there isn't much for
the rest of this wizard to configure with zero instances.

Per instance, one screen with two field groups (exact screen count —
one combined screen vs. two — is a call to make once it's built and
visible, not a spec-level decision):

- **Provider**: `displayName`, `xtreamBaseUrl`, `xtreamUser`,
  `xtreamPassword` — the schema's `Provider` group, unfiltered except
  hiding `m3uUrl` behind the existing "Advanced" disclosure.
- **Access**: a hand-built 3-way chooser — "Use my provider credentials" /
  "Set custom credentials" / "Use LDAP" — because "use provider
  credentials" isn't a real `authMode` value:
  - *Provider credentials*: no extra fields shown; submits
    `authMode: "basic"`, `authUser: xtreamUser`, `authPassword:
    xtreamPassword` (copied from the Provider fields just entered).
  - *Custom*: shows the schema's existing `authUser`/`authPassword` fields;
    submits `authMode: "basic"` with those values.
  - *LDAP*: shows the schema's existing `ldapServer`/`ldapBaseDn`/
    `ldapBindDn`/`ldapBindPassword` fields (`ldapRequiredGroup` stays
    behind Advanced); submits `authMode: "ldap"`.

Submits via `api.createStackInstance(patch)`, capturing the returned `key`
and `port`. Then: "Add another instance?" — yes loops back to a blank
Provider/Access screen; no advances to Step 2.

## Step 2 — Shared caching (once)

A small hand-built form, not tied to any one instance: "Cache VOD locally"
and "Buffer live channels for catchup" (+ "Hours of catchup to keep" when
catchup is on, `dependsOn`-style). These are wizard-only convenience
values — each instance still stores its own copy.

If either is turned on, an "Advanced: where should each instance's cache
live?" disclosure appears below, listing every instance created in Step 1
with its computed default path (`<SUITE_CACHE_DIR>/<name>`) shown as a
placeholder and an optional text field to override it — surfacing the new
`cachePath` field per instance, collapsed by default since most setups
never need it.

On continue: apply the shared VOD/catchup values to every instance created
in Step 1 via `Promise.allSettled(instances.map(i =>
api.updateStackInstance(i.key, patch)))`, where each instance's `patch`
also includes its own `cachePath` if one was typed in the disclosure above.

## Step 3 — Database (once)

Unchanged from today's wizard: the existing Postgres `SchemaForm`
(`mode: managed/external` + credentials), just resequenced to here.

## Step 4 — External access

**Part A** (per-instance loop, always shown — not gated on anything):
for each created instance, "Public base URL" (optional) and "Enable
Discord bot?" (optional). The Discord toggle stays disabled until that
instance's Public base URL is filled in, since `DISCORD_API_URL` is derived
from it. When Discord is enabled: bot token (secret) + optional admin role
id. Submits per-instance via `api.updateStackInstance`.

**Part B** (once, after the loop): "Want that same external URL to also
work on your local network?" — this is what Caddy is for, and only for
this; it is independent of Discord and of whether a public URL was set.
Yes turns on `caddyEnabled` (`api.saveStackSettings`) and shows the Caddy
`SchemaForm` filtered to its `HTTPS` group (`tlsMode`, `acmeEmail`). No
skips straight to Step 5 — instances with a public URL keep working for
Discord/external callers either way, they just won't additionally resolve
on the LAN through the Suite.

## Step 5 — VPN (once)

Same as today's wizard step 0: yes/no, then the gluetun `SchemaForm` if
yes (`api.saveStackSettings({ vpnEnabled })` + `api.saveComponent
("gluetun", patch)`) — just moved later in the sequence.

## Step 6 — Health check (only shown if VPN is on)

Only relevant when VPN is enabled, since it exists to let the watchdog
reconnect gluetun when a provider blocks the current exit IP:

1. Multi-select checklist of the instances created this run — "which
   should be health-checked?"
2. One screen listing a Stream ID input (hint: `12345.ts`, format is the
   operator's own responsibility to find) for each selected instance — not
   a strict one-at-a-time loop, since it's a single field per instance and
   looping screen-by-screen would be tedious for more than one or two.
3. Check times, defaulting to `04:00,16:00` (the same default
   `WatchdogCard` on the VPN page already shows).

Submits `healthCheckEnabled: true` + `healthCheckStreamId` per selected
instance via `api.updateStackInstance`, and one
`api.saveWatchdogSettings({ enabled: true, checkTimes })` call.
`maxReconnects` is left at its existing default — adjustable later on the
VPN page, not asked here.

## Step 7 — Done

Same ending as today: a summary card and "Review the stack plan" button to
`/stack`. Nothing is applied to Docker until that plan is reviewed and
applied — same as every other change this app makes.

## Out of scope

- Any change to the Stack page itself.
- Editing an instance's caching/health-check/Discord settings after setup —
  that already works today via Stack's per-component forms; this wizard
  only covers the guided first-run path.
- The exact screen count for Step 1 (combined vs. split Provider/Access) —
  left to be decided once it's visible, not a spec-level requirement.
