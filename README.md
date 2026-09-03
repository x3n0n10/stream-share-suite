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
| `SUITE_DATA_DIR` | `/data` | Where `suite.db` lives. From phase 2b, also the default location for every component's own configuration — see **Where component data lives** below. |
| `SUITE_CACHE_DIR` | — | Default VOD/catchup cache root for every instance. See **Where component data lives** below. |
| `SUITE_CONTAINER_PREFIX` | `streamshare-suite-` | Prefix for the default name of every container the Suite creates (gluetun, PostgreSQL, each instance). Change it only to run more than one Suite on the same Docker host — each needs a different prefix so their default names don't collide. Any component's `containerName` field, if set, always wins over the prefixed default. |
| `PUID` / `PGID` | `1000` / `1000` | Who owns the data directory, and who every component the Suite creates runs as. **Unraid: set `99` / `100`.** |
| `DOCKER_PROXY_URL` | `http://docker-socket-proxy:2375` | Where the Docker socket proxy is reachable. See **Stack management** below. |
| `NODE_ENV` | — | Set to `production` in the image |

### PUID / PGID

The entrypoint starts as root, takes ownership of `SUITE_DATA_DIR`, then runs the
app as `PUID:PGID` — never as root. This is what makes a bind-mounted directory
work: a named volume inherits the image's ownership, but a bind mount keeps
whatever the host says, and that rarely matches a uid baked into an image.

**Use bind mounts for `SUITE_DATA_DIR` and `SUITE_CACHE_DIR`, not named
volumes** — this changed from earlier phases. From phase 2b the Suite
bind-mounts a subfolder of each into every component it creates, and that only
works if they're real host paths: see **Where component data lives** below for
why. Every component the Suite creates also runs as this same `PUID:PGID`, for
the same reason the Suite itself does — a bind-mounted directory it creates
needs to be writable by whatever actually runs inside the container using it.

The entrypoint only chowns `SUITE_DATA_DIR` — it starts as root for exactly
long enough to fix that one directory, and nothing else. `SUITE_CACHE_DIR` gets
no such treatment, so its host directory needs to already be owned by (or
writable by) `PUID:PGID` before the Suite tries to use it. Get it wrong and the
first instance that needs it comes back "incomplete" naming exactly that,
rather than silently failing to write its cache.

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

A from-scratch install needs none of this: the bundled `docker-compose.yml`
also declares a plain bridge network named `streamshare`, puts the Suite on
it alongside `default` (the published port) and `docker-proxy-net` (an
`internal: true` network shared only with the socket proxy), and gluetun,
PostgreSQL and every instance join it by default — see each component's
"Docker networks to join" field, prefilled with `streamshare` and editable
only if you need something else. Nothing has to be typed in for the Suite to
create a fully self-contained stack.

That default stops being enough the moment something predates the Suite: an
existing instance or database lives on your own stack's network, not this
one, and gluetun's `FIREWALL_OUTBOUND_SUBNETS` must include whatever subnet
the Suite reaches it on (the reconciler sets this automatically for gluetun
itself — see below — but it must already be true for an existing instance to
reach the database). Add your own network as a fourth one, external so
compose doesn't try to create it, and point the relevant component's "Docker
networks to join" field at it instead of (or alongside) `streamshare`:

```yaml
services:
  suite:
    networks:
      - default
      - docker-proxy-net
      - streamshare
      - ssbackend   # reaching your existing gluetun and/or PostgreSQL

networks:
  streamshare:
    name: streamshare
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

Four kinds of component: **gluetun**, **PostgreSQL** (run by the Suite or an
external server you point at), **StreamShare instances** (as many as you have
providers) and **Caddy** — the last one is optional and off by default; see
its own section below. Six outcomes:

| Outcome | When | What happens |
| --- | --- | --- |
| Create | Nothing by that name exists | A new, managed container is created and started |
| No-op | A managed container already matches | Nothing — safe to click Apply on every page load |
| Recreate | A managed container's config has changed | Stop, remove, create, start — everything sharing its namespace briefly loses its connection |
| Adopt | A container exists but carries none of the Suite's labels | Left running, untouched — almost certainly one you set up by hand |
| Orphaned | The Suite created it, but its component has left the stack | Left running and reported. Removing it is its own confirmed action, never part of an Apply |
| Switched off | Its component is disabled, but a container by that name is still running and isn't the Suite's | Left running and reported, so switching something off never makes a running container vanish from the page |

Adopt is what you'll see the first time you point the Suite at a stack you
already run: Docker labels can't be added to a container after it's created,
so there is no way to bring an existing container under management without
either leaving it alone or replacing it. The Suite defaults to leaving it
alone. "Take over anyway" on the Stack page does the replacement explicitly,
never automatically.

Adoption is an exact name match, so it depends on the Suite expecting the
right name. gluetun, PostgreSQL and every instance each have their own
**Container name** field (under Advanced) for exactly this: set it to the
name of a container you already run, and the Suite adopts that one instead of
planning a `Create` under its own default name. Left blank, gluetun and
PostgreSQL default to `SUITE_CONTAINER_PREFIX` followed by `gluetun` or
`postgres` (`streamshare-suite-gluetun`, `streamshare-suite-postgres` unless
you've changed the prefix); an instance defaults to the prefix followed by its
key.

### Importing from running containers

Adopt only ever means "leave this container running, untouched" — it never
fills in the Suite's own configuration for it, so an adopted component's form
stays blank until someone types into it. **Import**, on the Stack page, is
what actually reads a real container's own image, environment and networks
and turns that into stored configuration, using the same field-to-env-var
mapping each component's own schema already declares, in reverse. The
container itself is never touched either way.

"Scan for existing containers" looks at every container on the host by
**image** rather than by name (`gluetun`, `postgres`, `stream-share`, but
never this project's own `stream-share-suite` or `stream-share-dashboard`
images) and lists whatever it finds that the Suite doesn't already manage.
Importing one:

- Recovers every field the schema can — VPN provider and keys for gluetun,
  admin credentials for PostgreSQL, provider and access settings for an
  instance — and sets a **Container name** override to the real name, so it
  keeps being adopted rather than planning a `Create` under the default one.
- For an instance, never regenerates its API key or database credentials —
  they're read straight from its own `INTERNAL_API_KEY`/`DB_*` environment,
  because the real database and role already exist under those exact values.
  Recreating that instance later without importing it first would generate
  new ones and leave it unable to reach its existing database.
- Folds anything the schema doesn't model into the same `extraEnv` box a
  hand-typed unmodelled setting already goes through, so nothing real gets
  silently dropped.
- Refuses a container already imported once (would otherwise create a
  duplicate instance pointed at the same real container) and a singleton
  that's already configured, unless asked to overwrite it.

### Instances

Adding an instance is a form, not a compose edit. Three things you would
otherwise have to work out are worked out for you:

- **Its port**, allocated from a band of 20, `8080`–`8099` by default. Change
  where that band starts under **Stack** if it's already taken by something
  else on your host — an instance that already has a port keeps it regardless.
  Allocation is otherwise *sticky*: adding a fifth instance never renumbers
  the first four, because that would recreate healthy containers to change
  nothing and break anything pointing at them.
- **Its API key**, generated and injected, so a new instance appears on the
  Overview page already authenticated with nothing typed.
- **Its address**, computed from the topology. With the VPN on that's gluetun's
  address at the instance's port; with it off it's the container's own name.
  Flip the toggle and every instance's address follows — it was never a value
  anyone typed, so there is nothing to go stale.

Each instance also gets its own database and role, created on first apply.
**Create if absent, never alter**: a database already under that name is used
as-is, never dropped or migrated. stream-share builds its own tables on
startup, so there is nothing for the Suite to migrate anyway.

Every instance is also editable after creation — click **Edit** on its row for
the same form, prefilled with what it's already configured with. Its key
(and so its default container name, if you haven't overridden that) is fixed
at creation and never changes even if you rename it later; a manually
overridden port that clashes with another instance's is rejected rather than
silently applied.

Removing an instance is a deliberate, name-confirmed action, so it takes the
container down as part of removal — stopped and removed outright, not left
running as an orphan for a separate step the way a container that becomes
unclaimed by something else (the VPN switched off, a config edit) is. An
adopted container is the one exception: never the Suite's to stop, so it's
left running exactly like Adopt always leaves it.

The container comes down before the database is touched, not after —
dropping a database an instance still holds a connection against fails in
PostgreSQL ("database is being accessed by other users") rather than
succeeding against one that's already gone. The database itself is **kept**
unless you tick the box and type the instance's name back, because a
container is trivially rebuilt and watch history is not.

### Caddy (reverse proxy)

An optional reverse proxy that publishes an instance under a real hostname
instead of a raw port, with HTTPS handled for you. Off by default — most
deployments don't publish anything externally, so it stays out of the stack
plan entirely until you switch it on under **Stack**.

There's no separate field for what to route — Caddy's configuration is
generated from whichever instances already have a **Public base URL** set
(under an instance's Addressing group): that hostname becomes a site block,
its path (if any) becomes a path-based route, and the target is the same
address the dashboard itself already computes for that instance. An instance
with no public base URL simply isn't published. Two instances can share one
hostname on different paths — each becomes its own route inside the same
site block.

HTTPS is either **self-signed** (Caddy's own internal CA — browsers warn
once, fine on a private network) or **automatic (ACME)**, which gets a real,
trusted certificate per hostname but needs ports 80 and 443 reachable from
the internet and each hostname's DNS already pointed here. Caddy joins the
shared network rather than gluetun's namespace — it only needs to *reach*
gluetun or an instance by name over Docker's own DNS, which needs the same
network, not a shared one.

### Setup wizard

A guided path through gluetun, PostgreSQL and your first instance, in that
order, for a fresh install — reachable from the sidebar or linked from an
empty stack plan. It doesn't do anything those components' own cards on the
Stack page couldn't already do; it only sequences the three forms that
matter most before anything else works and explains each one as it comes.
Leaving it partway through and finishing configuration from Stack instead
works exactly the same way — nothing about it is one-way, and it saves
through the same API the rest of the page uses. The last step hands off to
the stack plan to actually create the containers; nothing is created while
you're still in the wizard.

### Where component data lives

Two host paths — configuration and cache — set only in compose, never in the
UI. Both are environment variables, read once at startup, exactly like
`SUITE_DATA_DIR` already was for `suite.db`:

```yaml
environment:
  SUITE_DATA_DIR: /mnt/user/appdata/stream-share-suite
  SUITE_CACHE_DIR: /mnt/user/cache/stream-share-suite

volumes:
  - /mnt/user/appdata/stream-share-suite:/mnt/user/appdata/stream-share-suite
  - /mnt/user/cache/stream-share-suite:/mnt/user/cache/stream-share-suite
```

**Configuration** (`SUITE_DATA_DIR`) is the same folder `suite.db` already
lives in — every component gets its own subfolder there (`gluetun/`,
`provider-1/config/`, `postgres/data/`, ...). **Cache** (`SUITE_CACHE_DIR`)
is kept separate on purpose: VOD and catchup reach tens of gigabytes per
instance and usually belong on a different disk from a few kilobytes of
config, so sharing one path for both would be the wrong guess more often than
the right one.

Self-inspection — the trick that computes gluetun's `FIREWALL_OUTBOUND_SUBNETS`
from the Suite's own networks — can't replace this. `docker inspect` would
hand back every bind mount the Suite has, but not which one means "cache" and
which means "config", or whether a third one is for something else entirely.
That's a question about intent, and an environment variable is the cheapest
honest way to answer it — cheaper than a label, and no more typing than the
bind-mount line already needs.

There is no UI for either path — only these two environment variables. A
wrong or unmounted value still surfaces, just not as a settings-form error: it
shows up as an "incomplete" row on whichever component needs it (PostgreSQL,
an instance), naming exactly what's missing, the same way any other
unconfigured field does. Whichever paths you use, each must be mounted into
the Suite **at the same path on both sides**, as above.

That looks redundant and isn't. A bind mount is resolved by the Docker daemon
on the *host*, not inside the Suite's own container — so when the Suite tells
Docker to bind-mount a component's subfolder into a new container, the string
it hands over has to already mean the right thing to the daemon. Mounting
each path at the identical location on both sides is what makes that true
without needing a second "and where is that inside you" setting for every
path. Get this wrong — say, keep the old named-volume `suite_data:/data` from
an earlier phase instead of a bind mount — and it fails silently in the worst
way: the Suite can still read and write `/data` for its own database just
fine, so nothing looks wrong until it tries to share a subfolder of it with a
component's container and either can't find a real host path at all or,
worse, creates one somewhere unexpected. **Use bind mounts for both
`SUITE_DATA_DIR` and `SUITE_CACHE_DIR`**, never named volumes, for exactly
this reason.

Paths are validated when you save them, so a mistyped or unmounted one is a
message on the form rather than a container that fails to start — but that
check can only see "is this a writable directory from where I'm standing," so
it can't catch the named-volume case above from the inside.

The Suite creates each directory as its own `PUID:PGID`, mode `0777`, and runs
every component it creates as those same ids where it can — the stream-share
image runs as a non-root user and never chowns what it's given, so the two
have to agree, and this is the mechanism that makes them. Mode `0777` (rather
than owner/group-only) is what a container the Suite does not otherwise
control needs: an official postgres image starts as root and only drops to
its own uid after it can write into its data directory, and there is no way
to know that uid ahead of time. On a plain local filesystem root would not
even need the grant — but a FUSE-backed share (Unraid's `/mnt/user` among
them) can enforce mode bits against literal root too, which is exactly what
`mkdir: can't create directory ... Permission denied`, repeating on every
restart, means if you see it.

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

### The stack plan

Changes are reviewed across the whole stack rather than one component at a
time, because once components depend on each other the order matters and some
changes are not the single change they look like. The plan is ordered by
dependency, and each row says whether it is something you asked for or a
consequence of something else.

**The cascade.** A container that shares gluetun's network namespace does not
survive gluetun being replaced — Docker does not re-attach it, so it is left
with no network at all. Any plan that recreates gluetun therefore also
recreates everything inside it, marked as a cascade rather than as separate
decisions. Containers the Suite only adopted are the exception: they get a
warning instead, because recreating one would be a takeover nobody asked for.

**Orphans.** Switching the VPN off, or removing a component, can leave behind
a container the Suite created but no longer has any configuration for. Those
are reported as orphaned and left running. Apply never removes them — that is
a separate action with its own confirmation, because the reconciler should not
destroy a container it can no longer describe.

### Turning the VPN off (and back on)

Whether traffic routes through gluetun is one stack-wide setting rather than a
one-time setup choice, and rather than a per-instance one: a StreamShare
deployment shares a single tunnel, and per-instance tunnels would mean a
gluetun container each.

Switch it off and gluetun leaves the stack — its card stays configurable, but
it no longer appears in any plan as something to act on. What happens to a
container that's still running depends on who made it: one the Suite created
becomes an orphan you can remove when you're ready, while one you created
yourself is reported as switched off and left completely alone. Either way it
keeps running and stays on the page; switching a component off never silently
empties the plan while something is still up.

Switch it back on and gluetun returns with its configuration intact. From 2b
onwards the toggle also changes how every other component is addressed, so
expect the plan to show the whole stack recreating when it flips.

## Data and backups

The configuration that matters is one SQLite file at `$SUITE_DATA_DIR/suite.db`,
created `0600`. Back up that file and you have backed up every credential,
instance definition and component setting — it contains API keys and VPN
credentials in the clear, so treat a copy of it the way you would treat the
`.env` it replaces.

Everything else under `SUITE_DATA_DIR` (each component's own subfolder) and
under the cache path is runtime state stream-share itself manages — useful to
keep, but reconstructible, not the source of truth the way `suite.db` is.

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
| 1 | Schema registry and the reconciler, proven on gluetun; adopt an existing stack by label | shipped |
| 2a | Many components per kind, the dependency graph and cascade, the stack plan, the VPN toggle | shipped |
| 2b | Instances the Suite creates: container specs, port bands, per-instance databases, computed URLs | shipped |
| 2c | Import from running containers, Caddy routes, the setup wizard | shipped |
| 3 | Absorb the VPN watchdog: probe scheduling, server success memory, reputation groups | planned |
| 4 | Component inventory, release channels, rollback, backup/restore, hardened Docker agent | planned |

Phase 1 is the one that changed the Suite's threat model: it was the first
phase with any access to the Docker API at all, even mediated by the socket
proxy. See **Stack management** above for what that access is scoped to, and
the architecture notes for the fuller reasoning.

Phase 2a added no new Docker permissions, and neither 2b nor 2c adds any
either — the socket proxy's allowlist is unchanged throughout. Creating each
instance's database uses a PostgreSQL client rather than exec'ing `psql`
inside the container, which would have meant granting the proxy `EXEC`; exec
into any container is root on the host, and none of this needs that. Caddy is
the same story again: it reads its configuration from a file the reconciler
writes to a bind mount, not through anything the socket proxy would need to
grant.

## Licence

See [LICENSE](LICENSE).
