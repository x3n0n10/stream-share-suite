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

Each instance's VOD and catchup cache is a separate host path, entered on that
instance's form (in the wizard or on the Stack page). Caches can reach tens of
gigabytes and often belong on a different disk from the configuration.

The Suite does not read, create or check a cache path. It passes the path straight
to Docker as the bind-mount source for the instance container. This lets you point
a cache at a new disk without touching the compose file.

The trade-off is that the Suite cannot catch mistakes here. The directory must
already exist on the host and be writable by `PUID:PGID`. If it is not, the
instance fails to write its cache, and the error appears in the instance's own
logs, not in the Suite.

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
