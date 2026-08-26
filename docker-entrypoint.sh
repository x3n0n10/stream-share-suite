#!/bin/sh
# Reconciles the data directory's ownership with the user the app will run as,
# then drops privileges.
#
# This exists because the store is a file on a volume the operator supplies. A
# named volume inherits the image's ownership and would be fine, but a bind
# mount keeps the host directory's owner — and on Unraid that is 99:100, which
# matches no user inside the image. Without this, SQLite fails to create the
# database with a bare SQLITE_CANTOPEN that says nothing about permissions.
set -e

DATA_DIR="${SUITE_DATA_DIR:-/data}"

owner_of() {
  stat -c '%u:%g' "$1" 2>/dev/null || echo "unknown"
}

# Already non-root: the operator pinned a user (compose `user:` or
# `docker run --user`). We cannot chown anything from here, so verify the
# directory is usable and fail loudly rather than let SQLite fail obscurely.
if [ "$(id -u)" != "0" ]; then
  mkdir -p "$DATA_DIR" 2>/dev/null || true

  if [ ! -d "$DATA_DIR" ]; then
    echo "[entrypoint] FATAL: $DATA_DIR does not exist and could not be created" >&2
    echo "[entrypoint] Running as uid $(id -u):$(id -g). Create the directory on the host first." >&2
    exit 1
  fi

  if [ ! -w "$DATA_DIR" ]; then
    echo "[entrypoint] FATAL: $DATA_DIR is not writable" >&2
    echo "[entrypoint] Running as uid $(id -u):$(id -g), but the directory is owned by $(owner_of "$DATA_DIR")." >&2
    echo "[entrypoint] Either chown it on the host to match, or remove the 'user:' line from" >&2
    echo "[entrypoint] your compose file and set PUID/PGID instead so this container can fix it." >&2
    exit 1
  fi

  exec "$@"
fi

# Running as root: adopt the requested ids, fix the directory, then drop.
# 1000:1000 is the common default on a plain Docker host; Unraid wants 99:100.
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

mkdir -p "$DATA_DIR"

# Only chown when it is actually wrong. Recursively chowning an already-correct
# directory on every start is wasted IO, and on a network filesystem it is slow.
if [ "$(owner_of "$DATA_DIR")" != "$PUID:$PGID" ]; then
  echo "[entrypoint] Setting ownership of $DATA_DIR to $PUID:$PGID"
  chown -R "$PUID:$PGID" "$DATA_DIR"
fi

exec su-exec "$PUID:$PGID" "$@"
