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

Only three environment variables matter; everything else is configured in the
UI under **Settings**.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `SUITE_DATA_DIR` | `/data` | Where `suite.db` lives |
| `PUID` / `PGID` | `1000` / `1000` | Who owns the data directory. **Unraid: set `99` / `100`.** |
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

The Suite needs to reach your instances, and from phase 1 it will need to reach
PostgreSQL and the Docker daemon. It deliberately does **not** join gluetun's
network namespace: it manages gluetun, and a service inside that namespace
would sever its own connection the moment it recreated it.

In a typical stack that means attaching it to the internal network your
database is on, and addressing the instances through gluetun's address on that
network (`http://172.18.0.11:8080`, not `http://localhost:8080`). Gluetun's
`FIREWALL_OUTBOUND_SUBNETS` must include that subnet — it already must for the
instances to reach the database.

It needs **two** networks, and the second is easy to miss. An `internal: true`
network has no route in or out, so a container attached only to it cannot
publish a usable port — the UI would be unreachable. Keep the compose project's
default network for that, and add the internal one for talking to the stack:

```yaml
services:
  suite:
    networks:
      - default     # published port, and outbound from phase 4 on
      - ssbackend   # reaching gluetun and, later, PostgreSQL

networks:
  ssbackend:
    external: true  # already created by your main stack
```

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
| 0 | Ops surface on a database, with real auth | **this branch** |
| 1 | Schema registry and the reconciler; adopt an existing stack by label | planned |
| 2 | Setup wizard, port band allocation, per-instance database creation, Caddy route generation | planned |
| 3 | Absorb the VPN watchdog: probe scheduling, server success memory, reputation groups | planned |
| 4 | Component inventory, release channels, rollback, backup/restore, hardened Docker agent | planned |

Phase 0 needs no access to the Docker socket at all. That arrives in phase 1,
behind a socket proxy, and is the point at which the Suite's threat model
changes — see the architecture notes for why that boundary matters.

## Licence

See [LICENSE](LICENSE).
