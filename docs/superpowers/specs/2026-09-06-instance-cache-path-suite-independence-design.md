# Instance cache path: stop requiring it to be mounted into the Suite

## Context

Every host path the Suite hands to Docker as a bind-mount source for a
component it creates has, until now, also had to be mounted into the
Suite's own container at the identical path — because the Suite creates
and validates that directory itself (`ensureDirectory`/`validatePath` in
`server/src/store/paths.js`) using plain filesystem calls from inside its
own process, before ever telling Docker about it. This is true today for
`SUITE_DATA_DIR` (mounted once in compose, holds the Suite's own database
and every component's config subfolder) and, since the setup-wizard
idempotency work, for each instance's own `cachePath` — a real per-instance
host path for VOD/catchup cache, entered through the UI rather than compose,
so it can live on a different (often much bigger) disk than `SUITE_DATA_DIR`.

Because `cachePath` is per-instance and effectively unbounded — any host
path the operator wants — requiring it to also be mounted into the Suite
means every new cache location an operator wants to use needs a matching
compose edit and a Suite restart. That's fine, arguably expected, for the
one-time `SUITE_DATA_DIR` setup, but it defeats the point of a wizard that's
supposed to make adding and configuring instances a pure UI operation: an
operator who wants to point a new instance's cache at a new disk currently
has to leave the wizard, edit YAML, and restart the Suite before the
wizard's own path field will actually work.

This spec removes that requirement for `cachePath` specifically. It does
not change how `SUITE_DATA_DIR` works — the Suite still needs that mounted
into itself, still has the entrypoint chown it on startup, and still
validates it at plan time, because the Suite genuinely does read and write
there (its own database, every component's config).

## Scope

**In scope:** the Suite stops reading, creating, validating, or otherwise
touching an instance's `cachePath` itself. The path is handed straight to
Docker as the bind-mount source when the instance container is created —
resolved by the Docker daemon against the real host filesystem, the same as
any bind mount in a hand-written compose file. A small wizard copy change
that follows from no longer needing to guide the operator toward a
Suite-visible location.

**Out of scope:**
- Anything about `SUITE_DATA_DIR` — unchanged.
- Any new validation, self-inspection, or Suite-side directory management
  for cache paths (this was explored and explicitly rejected in favor of
  removing the requirement entirely, not making it smarter).
- Any change to the wizard's "one parent folder suggests a subfolder per
  instance" mechanism itself — it's pure string construction and already
  doesn't depend on Suite-side mount visibility.

## What changes

**`server/src/reconcile/instance.js`:** `renderInstanceSpec` currently does
```js
const cacheDir = cachingOn ? ensureDirectory(values.cachePath) : null;
```
`ensureDirectory` runs `mkdirSync`/`chmodSync` (wide open, `0o777`) from
inside the Suite's own container — which only does anything meaningful if
`values.cachePath` is also mounted there. This becomes simply using
`values.cachePath` directly as the volume source string, with no filesystem
call:
```js
const cacheDir = cachingOn ? values.cachePath : null;
```
The volume line construction below (`` `${cacheDir}:${CACHE_MOUNT}` ``)
doesn't change — `cacheDir` is still either the real path or `null`. The
config directory (`configDir`, a few lines above) is untouched: the Suite
still creates and owns that one itself, same as always.

**`server/src/reconcile/catalog.js`:** the instance kind's `ready()`
function currently is:
```js
ready: (values) =>
  validatePath(getDataPath(), "The stack data path") ||
  ((values.vodCacheEnabled === "true" || values.catchupEnabled === "true")
    ? validatePath(values.cachePath, "This instance's cache path")
    : null) ||
  (postgresTarget(getComponentValues("postgres")).host
    ? null
    : "No PostgreSQL server is configured yet."),
```
The middle clause (the `cachePath` validation) is removed entirely — an
instance's readiness now depends only on the stack data path and having a
Postgres target configured, matching the fact that the Suite no longer has
any way to check the cache path itself:
```js
ready: (values) =>
  validatePath(getDataPath(), "The stack data path") ||
  (postgresTarget(getComponentValues("postgres")).host
    ? null
    : "No PostgreSQL server is configured yet."),
```

**`server/src/store/paths.js`:** no change to `ensureDirectory` or
`validatePath` themselves — both are still used for `SUITE_DATA_DIR`-backed
paths (the config directory, Postgres's data path). This file simply loses
one caller.

**`web/src/pages/setup/StepCaching.jsx`:** the parent-path field
(currently around lines 116-127) drops its example placeholder and softens
its hint text. From:
```jsx
<input
  className={FIELD}
  value={parentPath}
  onChange={(e) => updateParentPath(e.target.value)}
  placeholder="/mnt/user/cache/stream-share-suite"
/>
<span className="text-[11px] text-slate-400 dark:text-slate-500">
  Suggests a subfolder below for any instance that doesn't already have a cache path.
</span>
```
to:
```jsx
<input
  className={FIELD}
  value={parentPath}
  onChange={(e) => updateParentPath(e.target.value)}
/>
<span className="text-[11px] text-slate-400 dark:text-slate-500">
  Suggests a subfolder below for any instance that doesn't already have a cache path.
  Any folder on the Docker host works — for example, a subfolder under the Suite's own
  data folder, if you don't need cache on a separate disk.
</span>
```
No placeholder attribute at all — the field starts genuinely blank with no
example value shown, since there's no longer a Suite-visible location the
UI can steer the operator toward as a known-good default the way it could
when the path had to be mounted into the Suite.

**`server/src/schema/instance.js`:** the `cachePath` field's `help` text
currently reads "there's no default, since it always has to be a path that
actually exists and is writable on this specific host" — still accurate,
but worth tightening now that the Suite never checks this itself:
```
Where this instance's VOD/catchup cache lives on the Docker host. Required
once VOD caching or catchup is turned on above. The Suite does not create
or check this path itself — it must already exist on the host and be
writable by the same user the Suite's other components run as (see
PUID/PGID in the Suite's own compose file), or the instance container will
fail to write its cache.
```

## Documentation

**`README.md`**, the "Each instance's VOD/catchup cache is a different
story" paragraph (currently lines 315-333) is rewritten. It currently says
a cache path "still has to be mounted into the Suite's own container at the
same path... because the Suite still can't create a directory at a host
path it can't see itself." That's no longer true and is replaced with the
opposite: the Suite never touches this path at all. The new text covers:

- The Suite hands the path straight to Docker as a bind-mount source for
  the instance container — it never reads, creates, or validates it, unlike
  `SUITE_DATA_DIR`.
- Because of that, **no compose edit or Suite restart is ever needed** for
  a cache path, regardless of how many instances exist or which disks
  they're on — the whole reason this is separate from `SUITE_DATA_DIR` in
  the first place.
- The operator is responsible for the directory existing on the host and
  being writable by the same `PUID:PGID` every other Suite-managed
  component runs as (since the stream-share image "runs as a non-root user
  and never chowns what it is given," per `instance.js`'s own comment) —
  there is no automatic chown or wide-open permission fix the way there
  used to be, so getting this wrong surfaces as a permission error in the
  *instance's own* container logs, not anywhere in the Suite's UI.
- This is a deliberate trade: the Suite trusts the operator on this one
  field the same way plain Docker Compose would, in exchange for cache
  paths never requiring the one-time YAML-editing ritual `SUITE_DATA_DIR`
  still requires.

## Testing

No new automated test infrastructure is introduced (`node --test` is the
existing backend runner; `web/` has none). Existing tests covering
`renderInstanceSpec`'s cache-mount behavior and `catalog.js`'s instance
`ready()` function need updating to match the removed `ensureDirectory`
call and removed `validatePath` check — the implementation plan enumerates
exactly which test files and assertions.

## Out of scope (deliberately)

- `SUITE_DATA_DIR`'s own handling — completely unchanged.
- Any self-inspection, mount-discovery, or smarter-validation mechanism for
  cache paths — considered during brainstorming and rejected in favor of
  removing the Suite-side requirement outright.
- Any change to the wizard's parent-path-suggests-subfolders mechanism's
  logic — only its placeholder/hint copy changes.
- Instance removal, plan/apply/history changes — unrelated to this spec.
