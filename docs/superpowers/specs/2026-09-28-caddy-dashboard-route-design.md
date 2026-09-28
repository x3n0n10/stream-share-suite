# Caddy dashboard route — design

## Goal

Let the Caddy component publish the Suite's own dashboard under a public hostname, the same way it already publishes each instance under its `publicBaseUrl`.

## Decisions

- The dashboard gets its **own hostname**, served at the root (for example `suite.example.com`). Path-based dashboard URLs (`tv.example.com/suite`) are out of scope: the web app and API use root-absolute paths (`/assets/...`, `/api/...`, Vite `base` unset), so a path prefix would need base-path support in the app, API and cookies.
- The setting lives on the **Caddy component**, not as a stack-wide setting. Caddy is the component that publishes things, and its schema already documents that its routes are derived from configuration held elsewhere.
- No change to the app, `docker-compose.yml`, or the plan/apply machinery.

## Design

### Field

`schema/caddy.js` gains one optional field:

- `dashboardUrl`, label "Dashboard public URL", group "Dashboard", not required.
- Help text: the address the dashboard is reached at from outside, for example `https://suite.example.com`; only the hostname (and port, if any) is used and any path is ignored; blank leaves the dashboard unpublished; the Suite must be on a Docker network Caddy joins (the default `streamshare` network covers this); publishing it exposes the login page to the internet (the Suite has a real login, CSRF protection and a throttled sign-in).

No new validation in the registry (it has no URL type). A value that does not parse as a URL is skipped, the same as an unparseable instance `publicBaseUrl` in `instanceRoutes()`.

### Reaching the Suite

`docker/self.js` gains `getSelfContainerName()`, using the existing technique (Docker sets the hostname to the short container ID; inspect accepts an ID prefix; the inspect result's `Name` is the container name without its leading slash). Any failure, or an empty result, falls back to `stream-share-suite`, the `container_name` in the shipped compose file, mirroring how `getSelfNetworks()` never throws. The target is `http://<name>:<PORT>`, with `PORT` taken from `process.env.PORT` and defaulting to `3000`.

This resolves over Docker DNS only when Caddy and the Suite share a network; by default both are on `streamshare`.

### Caddyfile

`reconcile/caddy.js`:

- `instanceRoutes()` stays as is. A new `dashboardRoute()` returns `{ host, path: "", target, dashboard: true }` when `dashboardUrl` parses, using `url.host`, else `null`.
- The dashboard route joins the same host grouping as instance routes, so it gets the same site block, `tls internal` handling and ACME behaviour.
- Ordering inside a site block: instance routes with a path first, then the dashboard. If the dashboard shares its host with path-based instance routes, it is emitted as `handle { reverse_proxy <target> }` so the `handle_path` blocks match first; when it is alone on its host it is a plain `reverse_proxy <target>`, like an instance with no path.
- The "no instance has a public base URL set yet" placeholder block is emitted only when there are no routes at all, dashboard included.
- `renderCaddyfile(values)` gains an optional second argument, `suiteTarget`, so it stays a pure synchronous function and existing callers and tests are unaffected. `renderCaddySpec` (already async) resolves the Suite's address once and passes it in, so the Docker call happens in one place. `suiteTarget` is only consulted when `dashboardUrl` is set.

### Plan and hash

No change. `CADDY_CONFIG_HASH` is derived from the Caddyfile text, so changing `dashboardUrl` (or the resolved Suite address) moves the spec hash and Caddy recreates through the normal plan.

### Docs

One sentence in the README's Caddy section: the dashboard can be published under its own hostname via the Caddy component's "Dashboard public URL".

## Testing

In `server/test/caddy.test.js`:

1. Dashboard URL only: the Caddyfile has one site block for that host with `reverse_proxy` to the Suite's address, and no placeholder block.
2. Dashboard on its own host beside an instance on a different host: two site blocks.
3. Dashboard on the same host as path-based instances: one site block, `handle_path` blocks first, dashboard as `handle { reverse_proxy ... }` last.
4. Blank or unparseable `dashboardUrl`: no dashboard block, existing output unchanged.
5. The spec hash changes when `dashboardUrl` changes.
6. `getSelfContainerName()`: returns the inspected name, and falls back to `stream-share-suite` when inspect fails or returns nothing (fake Docker, same style as the existing self-inspection tests if any, otherwise the reconciler test's fake server).

## Out of scope

- Path-based dashboard URLs.
- Automatic connection of the Suite to Caddy's network when the operator has changed Caddy's "Docker networks to join" away from a network the Suite is on.
