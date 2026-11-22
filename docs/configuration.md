# Configuration

Only a few environment variables matter. Everything else, including every
component the Suite manages, is configured in the UI.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `SUITE_DATA_DIR` | `/data` | Where `suite.db` lives, and the default location for each component's own configuration. See [data directory](#data-directory). |
| `SUITE_CONTAINER_PREFIX` | `streamshare-suite-` | Prefix for the default name of every container the Suite creates. See [running more than one Suite](#running-more-than-one-suite). |
| `PUID` / `PGID` | `1000` / `1000` | The user the data directory belongs to, and the user every component runs as. **On Unraid, set `99` / `100`.** |
| `DOCKER_PROXY_URL` | `http://docker-socket-proxy:2375` | Where the Docker socket proxy is reachable |
| `NODE_ENV` | — | Set to `production` in the image |

## PUID and PGID

The entrypoint starts as root, takes ownership of `SUITE_DATA_DIR`, then runs the
app as `PUID:PGID`, never as root. The bundled compose file sets this up for you.

Use a bind mount for `SUITE_DATA_DIR`, not a named volume. A named volume takes
the image's ownership, but a bind mount keeps whatever the host says, and that
rarely matches a uid baked into an image. The Suite needs a real host path so it
can share subfolders with the containers it creates. See
[data directory](#data-directory).

If SQLite fails with `unable to open database file` (`SQLITE_CANTOPEN`), the
Suite reports which uid it runs as and which uid owns the directory. The fix is
to match the ids, or let the container chown the directory.

To keep the container from ever starting as root, pin `user:` in compose instead.
The entrypoint then skips the chown and fails with a clear message if the
directory is not writable.

## Data directory

Set `SUITE_DATA_DIR` in compose only. It is read once at startup and has no
field in the UI. Mount the same host path into the Suite at the same location on
both sides:

```yaml
environment:
  SUITE_DATA_DIR: /mnt/user/appdata/stream-share-suite

volumes:
  - /mnt/user/appdata/stream-share-suite:/mnt/user/appdata/stream-share-suite
```

The same path on both sides matters because a bind mount is resolved by the
Docker daemon on the host, not inside the Suite's container. When the Suite asks
Docker to mount a component's subfolder, that path has to mean the same thing to
the daemon. A named volume such as `suite_data:/data` breaks this quietly: the
Suite can still write its own database, so nothing looks wrong until a component
mount fails or lands somewhere unexpected.

Inside the data directory, each component gets its own subfolder: `gluetun/`,
`provider-1/config/`, `postgres/data/`, and so on.

The Suite creates the directories it owns (configuration, and PostgreSQL's data
directory) as `PUID:PGID` with mode `0777`. Components it creates run as the same
identity. The `0777` mode is needed because the official postgres image starts as
root, and then drops to a uid the Suite cannot predict. On FUSE filesystems such
as Unraid's `/mnt/user`, the mode bits apply even to root. If you see
`mkdir: can't create directory ... Permission denied` repeating on each restart,
this is the cause.

Paths are validated when you save them. A typo or unmounted path shows up as an
"incomplete" row on the component that needs it, naming what is missing.

## Cache paths

Each instance's VOD cache, catchup buffer and (when kept on disk) provider catalogue
share one **cache location** on its form (in the wizard or on the Stack page).

**Leave it blank** and the cache goes in the data directory, in the instance's own
`cache/` subfolder. The Suite creates it, like its other folders, so nothing more
is needed.

**Caches can reach tens of gigabytes.** For anything beyond a small setup, enter a
path of your own on a disk meant for caching, with that much room free. This also
lets you keep the cache off the disk that holds your configuration.

The Suite passes the path you enter to Docker as the bind-mount source for the
instance container, so you can point a cache at a new disk without touching the
compose file. For such a path:

- If the directory does not exist yet, the Suite creates it owned by `PUID:PGID`
  before the instance starts.
- An existing directory that has files in it, or is owned by anyone but `root`,
  keeps its owner. It must be owned by, or writable for, `PUID:PGID`, because the
  instance runs as that user.

If an existing directory is not writable for that user, the instance fails to write
its cache, and the error appears in the instance's own logs, not in the Suite.

## Networks

The Suite talks to your instances, PostgreSQL, and the Docker daemon (through the
socket proxy). It deliberately does not join gluetun's network namespace. The
Suite manages gluetun, and a service inside that namespace would lose its own
connection the moment gluetun was recreated.

A fresh install needs no network setup. The bundled `docker-compose.yml` creates
a bridge network named `streamshare`. The Suite, gluetun, PostgreSQL and each
instance join it by default. Each component's **Docker networks to join** field
is prefilled with `streamshare`, and you only change it if you need something
else.

If your instances or database already run on another stack, add that stack's
network as a fourth network. Mark it `external` so compose does not try to create
it, then point the component's **Docker networks to join** field at it:

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

gluetun's `FIREWALL_OUTBOUND_SUBNETS` must include the subnet the Suite reaches
an existing instance on. The Suite sets this for gluetun it manages, but for an
existing instance to reach the database, it must already be true.

## Using an external PostgreSQL server

Pick **External server** on the wizard's Database step, or on the PostgreSQL
card of the Stack page, to use a server you already run instead of the one the
Suite manages. Enter its host, port, an admin user and the admin password.

### What the Suite creates

For each instance the Suite creates one role and one database on the server,
both named `streamshare_<key>` after the instance key (`test-a` becomes
`streamshare_test_a`). The role gets a generated password, which the instance
container receives. If the role already exists, the Suite updates its password
to the stored one. On PostgreSQL 16 and later, this needs the admin user to
have created that role itself or to hold `ADMIN OPTION` on it. If the database already exists, it is used as it is.

### Admin user privileges

The admin user needs `CREATEDB` and `CREATEROLE`, or superuser. To create a
database owned by an instance role, the admin user makes itself a member of that
role (with `SET` on PostgreSQL 16 and later). Expect the admin user to be listed
as a member of each `streamshare_<key>` role afterwards.

Without these privileges the apply fails with the server's own message, for
example `permission denied to create role` or `permission denied to create
database`. A missing `CREATEDB` can leave the new role behind on the server.

### Reaching the server

Both the Suite and every instance must reach the server. The Suite creates the
databases, the instances use them.

- **Container name.** Works when the server's container is on a network the
  instances join. By default that is `streamshare`. Add the network to the
  server's container, or add your server's network to each instance's
  **Docker networks to join** (see [networks](#networks)).
- **Host IP and published port.** Also works. Instances reach the host's
  published ports through the Docker bridge, so `<host-ip>` with the published
  port is enough. This was tested with the VPN off. With the VPN on, instances
  share gluetun's network, whose outbound firewall may block a host LAN IP. That
  is untested, so a container name on `streamshare` is the safer choice there. A host firewall that blocks traffic from Docker bridges might
  break this for the instances. That case is untested, so check it if instances
  cannot connect.

There is no connection test in the UI. A wrong setting shows up when you apply,
and the apply log shows the server's error unchanged. A wrong password fails
within a second or two. An unknown or mistyped hostname makes the apply wait
about 60 s before it fails, so check the host name first.

If an apply fails at the database step, the running instance is left as it was.
A stack apply stops at the first component that fails, so later instances are
not attempted in that apply.

### No admin password (trust auth)

The admin password is optional. If the server uses `trust` authentication, it is
ignored. The form cannot clear a password you have already stored: an empty
field means "unchanged". With `trust` auth the stored value does no harm.

### Removing an instance

By default the instance's database and role stay on the server, and the apply
log says so. Creating an instance with the same name later reattaches to that
database, history included. Choose **drop data** when removing to drop the
database and the role as well.

### Switching from the managed server

The Suite does not move data. Switching from the managed PostgreSQL to an
external server recreates each instance against a new, empty database on the
external server. The old data stays on the managed server, and nothing in the
UI says so.

The managed container keeps running and is listed in the Stack plan as
**Orphaned**. Removing it removes the container only. Its data directory under
the Suite's data folder stays on disk. Copying data over is up to you, for
example with `pg_dump` and `pg_restore` per instance database.

## Running more than one Suite

Change `SUITE_CONTAINER_PREFIX` only to run two Suites on one Docker host. Each
Suite needs its own prefix so their default container names don't collide.

Each Suite only lists, replaces or removes containers that carry its own prefix
label. Containers created before this label existed carry none. The Suite still
treats them as its own, so two Suites that already share a host see each other's
older containers until each is recreated.

To move an existing container to the label, stop it and click Apply on its own
Suite. Apply plans a recreate, and the new container gets the label. Until then,
do not remove "orphans" that belong to the other Suite.

Changing the prefix on a running Suite makes its existing containers look like
another Suite's. Remove those with Docker directly. A component's `containerName`
field, if set, always wins over the prefixed default.
