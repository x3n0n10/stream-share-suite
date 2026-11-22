# Give a new cache folder to PUID:PGID — design

Small change.

## Intent

An instance's "Cache location on the host" (`cachePath`) is a host path the Suite cannot
see. When that folder does not exist yet, the Docker daemon creates it on apply as
`root:root`. The instance runs as PUID:PGID (`user: ownershipString()`), cannot write to
it, and only works after the operator chowns the folder by hand. Today this is only
documented in the field's help text.

## Goals

- Entering a cache path that does not exist yet just works: after the apply the folder is
  owned by PUID:PGID and the instance can write to it.
- Also fixes a folder left behind root-owned and empty by an earlier apply.

## Non-goals / anti-goals

- Never change ownership of a folder that has anything in it, or that is owned by anyone
  but root. A path the operator already uses for something keeps its owner. No recursive
  chown.
- No change to the StreamShare image or its entrypoint; instances keep running as
  PUID:PGID, never as root.
- No change for a blank cache path (the Suite already creates that folder itself).

## Approaches

1. **One-shot helper container started by the Suite before the instance (picked).** No
   StreamShare change, works with any instance image version; costs about a second per
   create/recreate. The Suite already can create any container, so no new privilege.
2. StreamShare entrypoint starts as root, fixes ownership, drops to PUID:PGID. Every
   instance would start as root, and it changes the fork (upstream merge friction).
3. Check only: detect a root-owned folder and stop the apply with a clear message. Still
   leaves the chown to the operator.

## Design

- Runs from `prepareInstance` (`server/src/reconcile/provisioning.js`), i.e. only before
  an instance's container is created or recreated, after its image was pulled, and only
  when caching is on and `cachePath` is non-blank.
- The helper uses the instance's own image (already pulled, Alpine with busybox), runs as
  root (`User: "0:0"`), entrypoint overridden to `sh -c`, with `<cachePath>:/cache` bound.
  Docker creates the folder if missing. The script changes the owner of `/cache` to
  PUID:PGID only when it is owned by `0:0` and empty; otherwise it does nothing. Exits 0
  either way.
- The Suite waits for it to exit, then removes it. New Docker client call
  `waitContainer` (`POST /containers/{id}/wait`), covered by the socket proxy's existing
  CONTAINERS + POST grants.
- One log line in the apply when ownership was changed, e.g. "Gave the new cache folder to
  99:100." (the helper's exit code can signal "changed" vs "left alone").
- If the helper itself fails (custom image without a shell, Docker error), the apply logs a
  warning and carries on: the folder may well be fine, and the instance's own error says
  so if not.
- The cache path help text drops "must already exist ... Docker creates a missing folder as
  root" and says the Suite creates a missing folder with the right owner, but leaves an
  existing folder's ownership alone.

## Left to the builder

- Helper container name (derived from the instance's container name) and labels, so a
  helper left behind by a crash is not mistaken for a managed component or an orphan
  (remove any leftover by name before creating a new one).
- Tests: the helper's container payload (user, bind, command with the right ids), and the
  "helper fails, apply continues with a warning" path, with the Docker client mocked the
  way existing reconcile tests do.
