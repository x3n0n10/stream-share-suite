# Sidebar version block

## Context

Nothing in the UI says which version of the Suite is running, or which
versions the containers it manages are running. After the v1.0.0 release
(`docs/superpowers/specs/2026-09-21-v1-release-pipeline-design.md`) there is a
real version to show for the Suite itself, and an operator who updates an
instance or gluetun has no in-app way to confirm what actually came up.

This spec adds a compact block directly above the "Sign out" button in the
sidebar (desktop aside and mobile drawer) listing the running version of the
Suite and of every active component: each instance, PostgreSQL, gluetun and
Caddy.

## Decomposition

Two independent pieces, each with its own plan and PR:

1. **stream-share repo (Go, separate repository)**: embed a version at build
   time and serve it at `GET /api/internal/version`. Specified only as a
   contract here (below); it gets its own short spec, plan and release in that
   repo. Worktree off `origin/master`, commits with the GitHub noreply address.
2. **This repo (the Suite)**: everything else in this spec. It does not depend on
   piece 1 to ship: an instance whose stream-share release has no version
   endpoint falls back to its image label. Once instances run a stream-share
   release with the endpoint, the block shows the true running version with no
   further Suite change.

## Where each version comes from

"Version" means the running software's own report where one exists, and the
best information Docker has otherwise.

| Row | Primary source | Fallback chain |
| --- | --- | --- |
| Suite | `SUITE_VERSION` env baked into the image at build time | none (see below) |
| Instance | `GET <instance url>/api/internal/version` with its `X-API-Key` (contract below) | image label, image tag, short image ID |
| PostgreSQL | `SHOW server_version` over the Suite's existing admin connection | image label, image tag, short image ID |
| gluetun | `GET /v1/version` on its control server | image label, image tag, short image ID |
| Caddy | none available (its admin API exposes no version; `caddy version` is CLI-only) | image label, image tag, short image ID |

**Image fallback chain**, first hit wins, each tagged with a `source`:

1. The image's `org.opencontainers.image.version` label (`image-label`).
2. The image tag when it is specific, i.e. not `latest` (`tag`), e.g. `caddy:2.8`.
3. The short image ID, first 12 hex characters without the `sha256:` prefix
   (`image-id`).

When a container is not running the row reports `stopped` and no version query
is made. When a component is configured but has no container (an externally
added instance the Suite does not run), it reports `unknown` status, and only
the primary source is tried.

**gluetun detail.** `GET /v1/version` returns `{"version","commit","created"}`
(`internal/models/build.go` in gluetun). It is reachable with the `X-Api-Key`
the Suite already uses for `/v1/vpn/status`: the role the Suite configures
carries no route restriction. Unstable builds report a placeholder `version`
such as `latest` or `unknown`; in that case use the first 7 characters of
`commit` instead (`source: self`). If the request fails, fall through to the
image chain.

## Backend

### Suite version, baked into the image

- `Dockerfile`, runtime stage: `ARG APP_VERSION=dev` followed by
  `ENV SUITE_VERSION=$APP_VERSION`, next to the existing `ENV` lines.
- `.github/workflows/cd.yml`, the `Build and push` step: add
  `build-args: APP_VERSION=${{ steps.meta.outputs.version }}` (for `v1.0.0`
  metadata-action's `version` output is `1.0.0`).
- `.github/workflows/dev-build.yml`: add a step with `id: sha` that writes
  `short=${GITHUB_SHA::7}` to `$GITHUB_OUTPUT`, and pass
  `build-args: APP_VERSION=dev-${{ steps.sha.outputs.short }}`.
- A local `docker build` or `docker compose build` with no argument reports
  `dev`.
- The server reads `process.env.SUITE_VERSION` and reports `dev` if unset (plain
  `node src/index.js` in development).

Reading the Suite's own image label through self-inspection was rejected: it
depends on the hostname trick in `docker/self.js`, which the file's own header
calls unreliable when compose sets `hostname:`.

### `GET /api/stack/versions`

Mounted in `routes/stack.js`, so behind the same `requireAuth`/`requireCsrf` as
every other stack route. Response:

```json
{
  "suite": { "version": "1.0.0" },
  "components": [
    { "kind": "instance", "key": "provider-1", "label": "Provider 1",
      "status": "running", "version": "1.4.2", "source": "self" },
    { "kind": "postgres", "key": "", "label": "PostgreSQL",
      "status": "running", "version": "16.4", "source": "self" },
    { "kind": "gluetun", "key": "", "label": "Gluetun (VPN)",
      "status": "running", "version": "v3.40.0", "source": "self" },
    { "kind": "caddy", "key": "", "label": "Caddy (reverse proxy)",
      "status": "running", "version": "2.8", "source": "tag" }
  ]
}
```

- `status`: `running`, `stopped` (container exists, not running), `unknown` (no
  container to inspect).
- `version`: string or `null`. `source`: `self`, `image-label`, `tag`,
  `image-id`, or `null` when `version` is `null`.
- The row set is the stack as it stands: `activeComponents()` from
  `reconcile/catalog.js` (labels, container names), plus any externally added
  instance from the config's instance list. Switched-off components are not
  listed. The plan already reports leftover containers of switched-off
  components; this block does not.
- Container facts come from the existing `inspectContainer()` and
  `inspectImage()` in `docker/client.js`: `State.Running`, `Config.Image` (tag),
  the container's `Image` (ID) and the image's `Config.Labels`.
- PostgreSQL: a small exported helper in `reconcile/database.js` that opens the
  existing admin client (`withAdminClient`, currently module-private) and runs
  `SHOW server_version`. Applies to a managed or external server alike; when the
  connection target is not configured yet, skip to the image chain (or
  `unknown` for an external server).
- gluetun: a new `getVersion()` in `gluetunClient.js` reusing its `request()`
  and auth headers.
- Instances: a new `fetchVersion(instance, { timeoutMs })` in
  `instanceClient.js`, same shape as `fetchHealth`. Expects
  `{"success": true, "data": {"version": "<string>"}}` — the same envelope
  every `/api/internal/*` route uses — and reads `data.version`; anything
  else (404, non-JSON, no usable version, timeout) is a miss and falls
  through to the image chain.
- **Never throws and never blocks on one bad component.** Rows are collected
  in parallel. Within a row the lookups (container inspect, image inspect, the
  component's own report) run one after another, each with its own 3 second
  timeout, so a row is bounded by a few seconds. A failure only degrades that
  row to its fallback.
- **Cache:** the whole response is cached in memory for 60 seconds, with
  concurrent requests sharing one in-flight computation, so N browser tabs
  polling do not multiply Docker and instance calls. The cache is invalidated
  when a background job (an apply) finishes, so the sidebar confirms new
  versions on its next poll.

### stream-share endpoint contract (piece 1)

`GET /api/internal/version`, authenticated like every other `/api/internal/*`
route (`X-API-Key`), returning the house envelope
`{"success": true, "data": {"version": "<string>"}}` (shipped as
x3n0n10/stream-share#58, `pkg/version.Version`). The version is set at build
time via `-ldflags "-X .../pkg/version.Version=..."` from the GoReleaser
`{{.Version}}`; unstamped builds report `dev`. The Suite treats a missing
endpoint, or a response with no usable `data.version`, as a miss, so the two
pieces can ship in either order.

## Frontend

New component `web/src/components/VersionBlock.jsx`, rendered in
`Layout.jsx` immediately above the Sign out button in both the desktop `<aside>`
and the mobile drawer.

- Data: a new `api.stackVersions()` (`web/src/lib/api.js`), polled with the
  existing `usePolling` every 60 seconds.
- Layout: a small heading "Versions"; first row "Suite" with its version; then
  one row per component: label on the left, version on the right, a small
  status dot (green running, grey stopped or unknown). Long lists scroll inside
  the block (`max-h` with `overflow-y-auto`) so Sign out never leaves the screen.
- Value styling: `self`, `image-label` and `tag` are shown in normal text;
  `image-id` is shown as `image <12 hex>` in muted text; `null` shows
  `unknown` muted; a stopped container shows `stopped`.
- Collapsed sidebar (icon rail): the block is hidden. There is no room for it;
  Sign out and Collapse remain.
- While the first response is loading show nothing (no skeleton); on error keep
  the last data, and show nothing if there never was any. The version block is
  informational and must never surface an error banner.
- Dark and light themes follow the existing sidebar tokens; no new colours.

## Testing

- **Backend, `node --test`:**
  - Pure resolver for the image fallback chain: label wins over tag, a
    specific tag wins over image ID, `latest` falls to the image ID, missing
    label/tag/ID gives `null`.
  - gluetun version parsing: real version passes through; `latest` and
    `unknown` switch to the short commit; a failed request falls through.
  - The `/api/stack/versions` handler with stubbed Docker, gluetun, instance
    and database lookups: a running instance with the endpoint (`self`); the
    same instance where the endpoint 404s (fallback); a stopped container; an
    external instance (`unknown` status); a failing lookup never fails the
    request; the 60 second cache serves a second call without re-querying.
  - The route is behind auth like its siblings.
- **Frontend:** `web/` has no test framework. Verification is `npm run build`
  plus a manual walkthrough of the block in the desktop sidebar, collapsed
  sidebar, and mobile drawer, in light and dark.
- **Workflows:** the existing Ruby assertion approach from the release
  pipeline (parse the YAML, assert the `build-args` line). `docker` is not
  installed on the dev machine; the CI `docker-build` job covers the
  Dockerfile change.

## Out of scope

- "Update available" badges or any comparison against a registry.
- Version history, or a full page for it; this is a sidebar block only.
- Exec into containers to run a version command.
- The stream-share change itself (piece 1: own spec, plan, PR and release).
