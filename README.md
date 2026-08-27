# StreamShare Suite

One place to run a StreamShare stack: the instances, the VPN, the database, the
reverse proxy and the recorder. This repository is being built in phases —
see the phase plan below for what exists today and what is coming.

## What works today (phase 0)

The operations dashboard, with three changes that everything later depends on:

- **Configuration lives in a database, not environment variables.** Adding or
  editing an instance takes effect on the next poll. No compose edit, no
  container restart.
- **A real login.** Server-side sessions, a scrypt-hashed password, CSRF
  protection on every state-changing request, and a throttled sign-in.
- **Secrets are write-only.** Instance API keys and VPN credentials go in and
  are never rendered back — not to the UI, not to the API. A field shows only
  whether a value is set, and saving without touching it leaves it alone.

Everything the dashboard did still works: overview, history, leaderboard,
active users and streams, IP aliases, VOD search and download, and VPN
status/reconnect through gluetun's control server.

## Quick start

```sh
docker compose up -d
```

Then open `http://localhost:3000` and create the admin account. Nothing else
in the app answers until that account exists.

### Coming from stream-share-dashboard

Paste your existing `INSTANCE_N_*` and `GLUETUN_*` variables into the compose
file for the first boot. They are imported into the database once and then
ignored: after the import the store is the source of truth, so a variable left
behind cannot silently override an edit made in the UI. Delete them once the
import has run — the startup log says when it has.

## Configuration

Only a handful of environment variables matter; everything else — including
every component the reconciler manages — is configured in the UI.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `SUITE_DATA_DIR` | `/data` | Where `suite.db` lives |
| `PUID` / `PGID` | `1000` / `1000` | Who owns the data directory. **Unraid: set `99` / `100`.** |
| `DOCKER_PROXY_URL` | `http://docker-socket-proxy:2375` | Where the Docker socket proxy is reachable. See **Stack management** below. |
| `NODE_ENV` | — | Set to `production` in the image |

### PUID / PGID

The entrypoint starts as root, takes ownership of `SUITE_DATA_DIR`, then runs the
app as `PUID:PGID` — never as root. This is what makes a bind-mounted directory
work: a named volume inherits the image's ownership, but a bind mount keeps
whatever the host says, and that rarely matches a uid baked into an image.

Get it wrong and SQLite fails with a bare `unable to open database file`
(`SQLITE_CANTOPEN`). The Suite catches that and tells you which uid it is
running as and which owns the directory, but the fix is always the same: match
the ids, or let the container chown for you.

If you would rather the container never start as root, pin `user:` in compose
instead. The entrypoint detects that, skips the chown, and fails with a clear
message if the directory is not writable.

### Where to put it on the network

The Suite needs to reach your instances, PostgreSQL, and (via the socket
proxy — see below) the Docker daemon. It deliberately does **not** join
gluetun's network namespace: it manages gluetun, and a service inside that
namespace would sever its own connection the moment it recreated it.

In a typical stack that means attaching it to the internal network your
database is on, and addressing the instances through gluetun's address on that
network (`http://172.18.0.11:8080`, not `http://localhost:8080`). Gluetun's
`FIREWALL_OUTBOUND_SUBNETS` must include that subnet — the reconciler sets this
automatically for gluetun itself (see below), but it must already be true for
your existing instances to reach the database.

The bundled `docker-compose.yml` puts the Suite on two networks — `default`
(the published port, and outbound from phase 4 on) and `docker-proxy-net` (an
`internal: true` network shared only with the socket proxy). Add your stack's
own network as a third, external one to reach gluetun and PostgreSQL:

```yaml
services:
  suite:
    networks:
      - default
      - docker-proxy-net
      - ssbackend   # reaching gluetun and, later, PostgreSQL

networks:
  ssbackend:
    external: true  # already created by your main stack
```

## Stack management

The Suite reconciles a component's desired configuration against what's
actually running: save a configuration under **Stack**, and it renders a
container spec, hashes it, and compares that hash to what's deployed. Applying
does whatever the comparison calls for — create, recreate, or nothing — as a
background job with a log you can watch.

It never touches `/var/run/docker.sock` directly. All Docker API calls go
through [`tecnativa/docker-socket-proxy`](https://github.com/Tecnativa/docker-socket-proxy),
included in `docker-compose.yml`, with an allowlist granting only what the
reconciler actually calls (`CONTAINERS`, `NETWORKS`, `POST`) — everything else
is denied by default. A service that can create containers is root-equivalent
on the host, so it never gets unmediated access to the thing that lets it do
that.

**Gluetun** is the only component this phase manages — deliberately: it's the
one everything else shares a network namespace with, so it's where a mistake
costs the most. Four outcomes when you hit Apply:

| Outcome | When | What happens |
| --- | --- | --- |
| Create | Nothing by that name exists | A new, managed container is created and started |
| No-op | A managed container already matches | Nothing — safe to click Apply on every page load |
| Recreate | A managed container's config has changed | Stop, remove, create, start — everything sharing its namespace loses its connection until it's back |
| Adopt | A container exists but carries none of the Suite's labels | Left running, untouched — almost certainly one you set up by hand |

Adopt is what you'll see the first time you point the Suite at a stack you
already run: Docker labels can't be added to a container after it's created,
so there is no way to bring an existing container under management without
either leaving it alone or replacing it. The Suite defaults to leaving it
alone. "Take over anyway" on the Stack page does the replacement explicitly,
never automatically.

### Other VPN providers

The gluetun form's common fields (provider, WireGuard or OpenVPN, server
selection) cover most of gluetun's ~40 supported providers. A few need more:
Mullvad requires an explicit `WIREGUARD_ADDRESSES`, Private Internet Access
identifies servers by region rather than country — both appear in the form
automatically once you pick that provider. Anything not modeled yet has an
escape hatch: **Extra environment variables**, under Advanced, passes raw
`KEY=VALUE` lines straight to the container. It isn't validated the way the
named fields are, and a named field always wins if it sets the same key — so
it fills gaps without being able to silently override something the form
already validated.

### Adding (or removing) VPN later

Whether traffic routes through gluetun is a single stack-wide setting, not a
one-time setup choice — change it later and the reconciler picks it up the
same way it picks up any other configuration change. The catch is blast
radius: everything sharing gluetun's network namespace gets recreated, so
expect the plan to show `recreate` for every such component at once instead
of one at a time, with the accompanying downtime while they restart.

## Data and backups

Everything is one SQLite file at `$SUITE_DATA_DIR/suite.db`, created `0600`.
Back up that file and you have backed up the entire configuration. It contains
instance API keys and VPN credentials in the clear, so treat a copy of it the
way you would treat the `.env` it replaces.

## Development

```sh
cd server && npm install && npm test     # backend + API tests
cd web && npm install && npm run dev     # frontend on :5173, proxying to :3000
```

To run the backend against a local store:

```sh
cd server && SUITE_DATA_DIR=../data PORT=3000 npm start
```

## Phase plan

| Phase | Ships | Status |
| --- | --- | --- |
| 0 | Ops surface on a database, with real auth | shipped |
| 1 | Schema registry and the reconciler, proven on gluetun; adopt an existing stack by label | **this branch** |
| 2 | Instances, Caddy and UHF as reconciled components; the setup wizard; port band allocation; per-instance database creation | planned |
| 3 | Absorb the VPN watchdog: probe scheduling, server success memory, reputation groups | planned |
| 4 | Component inventory, release channels, rollback, backup/restore, hardened Docker agent | planned |

Phase 1 is the one that changes the Suite's threat model: it's the first
phase with any access to the Docker API at all, even mediated by the socket
proxy. See **Stack management** above for what that access is scoped to, and
the architecture notes for the fuller reasoning.

## Licence

See [LICENSE](LICENSE).
