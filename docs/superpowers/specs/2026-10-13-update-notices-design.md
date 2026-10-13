# Update notices in the version block

## Context

The sidebar version block (`docs/superpowers/specs/2026-09-21-version-block-design.md`)
shows the running version of the Suite and of each active component. It cannot
say whether a newer one exists. The only update mechanism today is the manual
**Check for updates** button, which pulls a component's tag and recreates it if
the content changed.

This spec adds a quiet "newer version available" hint to the version block, fed
by a daily background check against each project's GitHub repository. Nothing is
pulled and the Docker proxy needs no new permission.

## Decisions

- **Source of truth is GitHub.** The block already holds a release version or a
  commit per row, so the check compares that with the upstream repo.
- **Scope:** the Suite, instances, gluetun, and Caddy only when its image tag is
  a specific version. PostgreSQL is skipped: patch updates are deliberate, majors
  are migrations, and it has no GitHub releases.
- **Indicator:** inline `current → latest` on the affected row, plus a dot on the
  collapsed header.
- **Setting:** `Automatically check for updates`, on by default, in Settings →
  General. When off, no check runs and no indicator shows.
- **Schedule:** once a day, surviving restarts.

## Which rows are checked

A row is eligible when its `status` is `running` and its version is not `null`.
Rows whose `source` is `image-id` are never checked. A version string is parsed
as one of:

- **Release:** optional leading `v`, then `MAJOR.MINOR.PATCH` (a pre-release or
  build suffix after the patch is allowed and ignored). Example: `1.4.2`,
  `v3.40.0`.
- **Commit:** `dev-<sha>`, a bare 7 to 40 character hex string, or the `-g<sha>`
  suffix of `git describe` output. Example: `dev-a1b2c3d`, `a1b2c3d`,
  `v1.0.0-3-ga1b2c3d`.
- Anything else (`dev`, `2-alpine`, `unknown`) is not checked.

| Row | Repo | Default branch | Eligible when |
| --- | --- | --- | --- |
| Suite | `x3n0n10/stream-share-suite` | `main` | release or commit |
| Instance | `x3n0n10/stream-share` | `master` | release or commit |
| gluetun | `qdm12/gluetun` | `master` | release or commit |
| Caddy | `caddyserver/caddy` | not used | `source` is `tag` and the version is a release |

**Standard images only.** Instance, gluetun and Caddy rows are checked only when the
running container's image is the standard one: `ghcr.io/x3n0n10/stream-share`,
`qmcgaw/gluetun` or `ghcr.io/qdm12/gluetun`, and `caddy`. The image name is compared
without its tag or digest, ignoring a leading `docker.io/` and `library/`, so any
tag matches. A fork, a mirror, a custom build or an unknown image (no container, or
an external instance) is never checked, because it numbers itself. The Suite has no
image rule: it cannot read its own image name reliably. To make this possible each
row in `/api/stack/versions` also carries `image`, the running container's image
reference, when there is one.

The implementer confirms each default branch with `gh api repos/<repo> --jq
.default_branch` before hard-coding it.

## How "newer" is decided

- **Release rows:** `GET /repos/{repo}/releases/latest` (GitHub already excludes
  drafts and pre-releases). Strip a leading `v` from both, compare the three
  numbers left to right. `latest` is newer when it is strictly greater. The shown
  `latest` keeps a leading `v` if and only if the current version has one.
- **Commit rows:** `GET /repos/{repo}/compare/{sha}...{defaultBranch}`. When
  `ahead_by > 0` the branch has moved on. The shown `latest` is the first 7
  characters of the branch head, read once per repo per run with
  `GET /repos/{repo}/commits/{defaultBranch}`. A 404 (unknown commit, such as a local dirty
  build) means no update, not an error.
- **Request failures** (network error, timeout, 403, 429, 5xx) are failures for
  that row, not "no update". The row keeps its previous stored result.
- Requests send `Accept: application/vnd.github+json`,
  `X-GitHub-Api-Version: 2022-11-28`, and a `User-Agent` of
  `stream-share-suite/<suite version>`, with a 10 second timeout each. There is
  no token option. One run makes at most one release or head request per distinct repo,
  plus one compare request per commit row.

## Backend

New directory `server/src/updates/`:

| File | Responsibility |
| --- | --- |
| `compare.js` | Pure. `parseVersion(text)` returns `{ type: "release", numbers, hasV }`, `{ type: "commit", sha }` or `null`. `isNewerRelease(current, latest)`. |
| `upstream.js` | GitHub client with an injectable `fetch`. `latestRelease(repo)` returns the tag name or `null`. `commitsAhead(repo, sha, branch)` returns `{ ahead: boolean, head: string }` or `null` on 404. Throws on any failure listed above. |
| `check.js` | `runUpdateCheck({ versions, upstream, store })` and `withUpdates(versionsResponse)`. Holds the repo table above. |
| `scheduler.js` | `startUpdateScheduler()` and `kickUpdateCheck()`. |

### Setting and stored result

- Setting `general.auto_update_check`, read with `getBoolean(..., true)`, so it is
  on until someone turns it off.
- `GET /api/settings` returns `general.autoUpdateCheck` (boolean). `PUT
  /api/settings` accepts it and stores `"1"` or `"0"`.
- When a `PUT` flips it from off to on, the handler calls `kickUpdateCheck()`
  without awaiting it, so the first result does not wait for the next tick.
- Results are kept in one setting, `update_check_result`, as JSON:

```json
{
  "checkedAt": "2026-10-13T08:00:00.000Z",
  "attemptedAt": "2026-10-13T08:00:00.000Z",
  "suite": "1.0.1",
  "rows": { "instance:provider-a": "1.4.3", "gluetun:": "v3.41.0" }
}
```

`suite` and the `rows` values are the `latest` string, present only when a newer
version exists. A row key is `<kind>:<key>`, matching the version block.
`checkedAt` is the last run that completed with no failures. `attemptedAt` is the
last run of any kind.

### Scheduler

- Same wall-clock polling approach as `watchdog/scheduler.js`. `startUpdateScheduler()`
  is called from `index.js` next to `startWatchdogScheduler()`. It runs a first
  tick 60 seconds after boot, then one every hour. Timers are `unref`ed.
- A tick runs the check only when the setting is on, `checkedAt` is missing or at
  least 24 hours old, and `attemptedAt` is missing or at least 1 hour old. A
  restart therefore never causes an extra check, and a failed run retries after
  an hour.
- The check takes the current rows from `getVersions(config)` and clears stored
  results for rows that no longer exist.
- `kickUpdateCheck()` runs immediately and skips the 24 hour rule. Only the hourly
  tick applies it. A run already in progress makes a second call a no-op.
- A run never throws out of the tick. Errors are logged with one `[updates]` line.

### `/api/stack/versions`

The handler in `routes/stack.js` passes the response through `withUpdates()`.
Each component row gains `latest: string | null`, and `suite` gains `latest`.
This joins the stored result and makes no outbound call. The in-memory 60 second
cache keeps holding the plain versions. The join happens per request, after the
cache. When the setting is off every `latest` is `null`.

A stored `latest` is shown only while it is still newer than the row's current
version, re-checked with the same comparison at join time. After an apply
upgrades a row, its hint disappears without waiting for the next check.

## Frontend

- `VersionBlock.jsx`: a row with `latest` shows its version as
  `current → latest` on a second line under the label, with `latest` in the accent
  colour (`text-accent-500` or the nearest existing accent token) and the arrow
  muted. The row's `title` reads `Update available: <latest>`.
- The collapsed header shows a small accent dot (`h-1.5 w-1.5 rounded-full`) next
  to the Suite version when `suite.latest` or any row's `latest` is set.
- When `suite.latest` is set, the expanded list starts with an extra Suite row in
  the same `current → latest` form. With no Suite update that row does not exist.
- Nothing else changes: no banner, no toast, no new request. The block keeps its
  existing polling.
- `Settings.jsx`, `GeneralSection`: an "Automatically check for updates" field
  using the existing on/off button pair pattern, wired into the same Save. Hint:
  "Once a day the Suite asks GitHub for the latest release of itself, StreamShare,
  gluetun and Caddy. Nothing is downloaded or changed."
- `lib/api.js`: no new endpoints. The settings payload gains `autoUpdateCheck`.

## Testing

Backend, `node --test`:

- `parseVersion`: releases (`1.4.2`, `v3.40.0`, `1.0.0-rc1`), commits
  (`dev-a1b2c3d`, `a1b2c3d`, `v1.0.0-3-ga1b2c3d`), and rejects (`dev`, `2-alpine`,
  `unknown`, `latest`).
- `isNewerRelease`: greater, equal, lower, numeric not string ordering
  (`1.10.0` over `1.9.0`), a `v` on one side only.
- `upstream.js` with a stubbed `fetch`: latest release parsing, ahead and behind
  commit results, 404 on compare returns `null`, 403, 429, 5xx and a thrown error
  all throw.
- `runUpdateCheck`: only eligible rows are queried (image-id, stopped, null,
  PostgreSQL and a non-version Caddy tag are skipped); results are stored; a
  failing row keeps its previous value; one failure does not stop the others;
  `checkedAt` is not advanced when anything failed.
- Scheduler due logic as a pure function: disabled, never run, under 24 hours,
  over 24 hours, failed within the hour, failed over an hour ago.
- `withUpdates`: attaches `latest`, hides it when the setting is off, drops a
  stored hint that is no longer newer.
- Settings route: `autoUpdateCheck` defaults to `true`, round-trips, and flipping
  it on calls the kick hook.
- `/api/stack/versions` stays behind auth.

Frontend: `web/` has no test framework. Verify with `npm run build`, then check
the block collapsed, expanded and in the mobile drawer, in both themes, with a
mocked versions payload that has a mix of rows with and without `latest`.

## Check now

- `POST /api/stack/updates/check` (behind auth and CSRF like its siblings) runs the
  check immediately and waits for it. It answers `409` when automatic checks are
  off, otherwise `{ checkedAt, attemptedAt, complete }`, where `complete` means the
  run had no failures.
- `GET /api/settings` general gains `updateCheckedAt` (the last complete run, or
  `null`).
- Settings → General: a **Check now** button under the toggle, disabled while the
  toggle is off, with "Last checked <time>" beside it. A run that had failures
  shows "Some checks failed. The Suite retries within the hour." After a run the
  sidebar block refreshes at once through a `versions:refresh` window event.

## Docs

- `docs/backups-and-updates.md`, "Checking for updates": add the daily check and
  the setting. Say it contacts `api.github.com`, sends no credentials, shows
  `current → latest` in the sidebar, changes nothing by itself, and can be turned
  off. Keep the existing manual-button text.
- `docs/dashboard.md`: one sentence on the sidebar's version block and the hint.

## Out of scope

- Pre-releases, PostgreSQL, a `GITHUB_TOKEN` option,
  applying updates automatically, any notification outside the sidebar, and
  comparing a pinned release tag against a newer registry tag.

## Implementation split

Three independent pieces that touch separate files and can be built in parallel
from the contracts above:

1. **Backend** (`server/`): everything under Backend and its tests, plus the
   settings route and `index.js` wiring.
2. **Frontend** (`web/`): everything under Frontend.
3. **Docs** (`docs/*.md`, excluding this spec).
