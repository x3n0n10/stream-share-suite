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

This is a frontend-heavy pass with two bounded backend changes (Discord
fields, and replacing the shared `SUITE_CACHE_DIR` mechanism with an
explicit per-instance cache path — see below, larger than "small" for the
second one since it touches a compose-time env var and its docs, but still
fully contained to a handful of named files). It
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

## Backend change: per-instance cache path replaces `SUITE_CACHE_DIR`

Every instance's VOD/catchup cache lives at `<SUITE_CACHE_DIR>/<instance
name>` today — one shared host path for the whole Suite, set once in
compose (`server/src/store/paths.js`'s `getCachePath`/`componentCacheDir`).
Per instruction, this spec removes that mechanism entirely rather than
adding an override alongside it: `SUITE_CACHE_DIR` has exactly two
call sites in the codebase (`reconcile/instance.js:88` and
`reconcile/catalog.js:105`), both of which this change replaces, so there's
nothing left over to keep it for. (The container-internal mount point
stays `/cache`, unchanged and not user-facing — confirmed against
`reconcile/instance.js`'s `CACHE_MOUNT` constant, which is the actual
current value despite an earlier `/tmp/cache` mention in this doc's
history.)

**Schema**: add to `INSTANCE_SCHEMA`'s existing `Container` group:

| Key | Env var | Type | Notes |
|-----|---------|------|-------|
| `cachePath` | — | text | Host path. Required whenever `vodCacheEnabled` or `catchupEnabled` is true for that instance; no default. |

**Schema-engine gap this surfaces**: `requiredWhen` (see
`server/src/schema/registry.js`) currently ANDs an array of conditions —
there's no way to express "required if *either* of these is true," which
is exactly what `cachePath` needs. `registry.js`'s `conditionMet` needs a
small addition — an `any: [...]` form alongside the existing implicit
AND-array, e.g.:

```
requiredWhen: { any: [
  { key: "vodCacheEnabled", equals: true },
  { key: "catchupEnabled", equals: true },
] }
```

This is the one genuinely new piece of shared schema-engine logic in this
spec; everything else reuses `dependsOn`/`requiredWhen` exactly as they
exist today.

**The cache mount becomes conditional.** Today `renderInstanceSpec` mounts
a cache volume for every instance unconditionally, whether or not it
caches anything. Without a global root to fall back to, that no longer
makes sense for an instance with both caching flags off — so
`reconcile/instance.js` changes to skip the cache directory and its volume
entry entirely unless `vodCacheEnabled || catchupEnabled`:

```
const cachingOn = values.vodCacheEnabled === "true" || values.catchupEnabled === "true";
const cacheDir = cachingOn ? ensureDirectory(values.cachePath) : null;
// ...
volumes: [
  `${configDir}:${CONFIG_MOUNT}`,
  ...(cacheDir ? [`${cacheDir}:${CACHE_MOUNT}`] : []),
],
```

(`CACHE_FOLDER` is already only meaningful to stream-share when it's
actually using the cache, so leaving it unset when there's no mount needs
no special handling beyond `renderEnv`'s existing "omit rather than send
empty" behavior.)

**Readiness check**: `reconcile/catalog.js`'s instance `ready()` drops its
unconditional `validatePath(getCachePath(), "The cache path")` and instead
validates `values.cachePath` only when that instance is actually caching:

```
ready: () =>
  validatePath(getDataPath(), "The stack data path") ||
  (cachingOn ? validatePath(values.cachePath, "This instance's cache path") : null) ||
  ...
```

**Cleanup**: `getCachePath` and `componentCacheDir` in `store/paths.js`
become dead code once nothing calls them — delete them, along with their
env var read and the tests exercising them (`paths.test.js`'s two
`SUITE_CACHE_DIR` tests, and the `SUITE_CACHE_DIR` setup/teardown in
`instance.test.js`, `caddy.test.js`, `import.test.js`). Remove
`SUITE_CACHE_DIR` from `docker-compose.yml` and the README's "Where
component data lives" section (which currently documents it as a
stack-wide path alongside `SUITE_DATA_DIR` — that section needs rewriting
to explain cache is now per-instance and explicit, not a compose-time
setting at all).

**Compatibility**: no migration code. An existing install with
caching-enabled instances will see them marked "not ready" until their
`cachePath` is filled in once after upgrading — the underlying cache
directory and its data don't move, the operator just retypes the same
host path (previously `<old SUITE_CACHE_DIR>/<instance-name>`) into the
new field.

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

If either is turned on, a "Where should this stuff live?" section appears
below: one required host-path input for a parent folder — no default, the
operator must type it. Once that's filled in, every instance created in
Step 1 shows a suggested subfolder, `<parent>/<instance.key>` (the
instance's real, already-assigned key from Step 1 — not a re-derived
preview slug, since it already exists by this point), as an **editable**
text input, not a placeholder: the suggestion is a real value the user can
accept as-is or type over, individually per instance. Continuing is
blocked until every listed instance's field is non-empty.

On continue: apply the shared VOD/catchup values, plus each instance's own
(possibly-edited) `cachePath`, to every instance created in Step 1 via
`Promise.allSettled(instances.map(i => api.updateStackInstance(i.key,
patch)))`.

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
