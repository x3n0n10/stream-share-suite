# Suite instance label — design

## Problem

Two Suites on one Docker host (for example a stable and a dev build) see each other's containers. The orphan pass (`findOrphans`) lists every container carrying `streamshare.suite.managed=true`, and nothing on a container says which Suite created it. So one Suite's components show up as orphan rows in the other. Removing an "orphan" is a plain stop and remove by container ID, so one Suite could destroy the other's stack. `planComponent` matches by container name alone, so a same-named container created by the other Suite is treated as its own.

## Decisions

- A Suite is identified by its **`SUITE_CONTAINER_PREFIX`** (`containerPrefix()`), which the README already requires to differ between Suites on one host. No new stored state, no new environment variable.
- The label is **not** part of the spec hash (like the other managed labels), so upgrading recreates nothing.
- A managed container with **no** instance label (created before this change) is treated as this Suite's own. Otherwise every existing install would see its whole stack turn foreign on upgrade. Docker labels cannot be added to a running container, so a legacy container gets the label the next time it is recreated.
- Two Suites must still use different prefixes. The label makes that safe (a Suite never touches another's containers) but does not make two Suites on one prefix work.

## Design

### Label

`docker/labels.js`:

- `LABEL_SUITE = "streamshare.suite.instance"`.
- `managedLabels(kind, specHash, key)` adds `[LABEL_SUITE]: containerPrefix()`. `containerPrefix()` lives in `reconcile/prefix.js` (no imports of its own, so no import cycle).
- `belongsToAnotherSuite(labels)`: true only when the container is managed, carries `LABEL_SUITE`, and its value differs from `containerPrefix()`. Unmanaged containers and legacy managed containers (no label) are false.

### Where it applies

- `findOrphans` (`reconciler.js`): skips a container that `belongsToAnotherSuite`. The Docker label filter can't express "absent or equal", so it stays a `managed=true` filter plus this check in code.
- `planComponent` (`reconciler.js`): a container found by name that `belongsToAnotherSuite` plans as `adopt`, the same "never touched without a takeover" handling as a foreign container, with a reason naming the conflict and a warning pointing at `SUITE_CONTAINER_PREFIX`. Explicit takeover remains the escape hatch, as for any adopted container.
- `removeOrphan` (`reconciler.js`): inspects the container first and refuses one that `belongsToAnotherSuite` (throws, so the job reports failure) instead of stopping and removing it.
- `deprovisionInstance` (`provisioning.js`): only stops and removes a same-named container that is managed and not another Suite's; otherwise it leaves it running with a log line.
- `import.js` already skips every managed container, so it needs no change.

### Known limitation

Changing `SUITE_CONTAINER_PREFIX` on an existing Suite already changes every default container name (the old containers become orphans). With this change those old containers carry the old prefix as their label, so they read as another Suite's and are no longer listed or removable from the Suite's UI. They can be removed with Docker directly. Documented in the README.

## Testing

- `labels`: `managedLabels` carries the prefix (default and an env override); `belongsToAnotherSuite` for another Suite's label, this Suite's label, a legacy managed container, and an unmanaged one.
- `findOrphans` (through `planStack`): another Suite's container is not listed as an orphan; this Suite's is; a legacy unlabeled one still is.
- `planComponent`: a same-named container labeled for another Suite plans as `adopt` with a warning; one with this Suite's label still plans `noop`.
- `removeOrphan` route: refuses a container labeled for another Suite and leaves it running.
- `deprovisionInstance`: leaves another Suite's same-named container running.

## Out of scope

- A generated per-install ID, and any migration or relabeling of existing containers.
- Making two Suites on the same prefix work.
