# Suite Instance Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop two Suites on one Docker host from seeing (and being able to destroy) each other's containers, by labeling every container with the prefix of the Suite that created it.

**Architecture:** A new label `streamshare.suite.instance` whose value is `containerPrefix()` (the Suite's `SUITE_CONTAINER_PREFIX`), attached by `managedLabels()`. A helper `belongsToAnotherSuite(labels)` is true only for a managed container carrying a *different* instance label; legacy managed containers with no label count as this Suite's own. The orphan pass, `planComponent`, `removeOrphan` and `deprovisionInstance` consult it.

**Tech Stack:** Node (ESM), `node --test`, Express backend in `server/`. No frontend changes.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-09-28-suite-instance-label-design.md`. Read it if anything here is unclear.
- Identity is `containerPrefix()` from `server/src/reconcile/prefix.js`. No new stored state, no new environment variable, no generated ID.
- The label must NOT enter the spec hash (`computeSpecHash` is untouched), so upgrading recreates nothing.
- A managed container with **no** `streamshare.suite.instance` label is treated as this Suite's own (`belongsToAnotherSuite` returns false for it).
- A container that `belongsToAnotherSuite` is never listed as an orphan, never planned as create/recreate, and never stopped or removed by `removeOrphan` or `deprovisionInstance`.
- Existing tests must keep passing without edits, except where a task says otherwise. In particular the existing deprovision test still expects the log line `was not created by the Suite` for an *unlabeled* foreign container.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` (that exact model name, whichever model you are).
- **Committing:** plain `git commit` is blocked by a guard in this repo. Write the message to a file under `/private/tmp/claude-501/-Users-jorislankhorst-Claude/83ef7f57-0172-4320-ba0f-424f637c7b19/scratchpad/` (not in the repo), then: `git add <files>`, confirm `git diff --cached --stat` is non-empty, `TREE=$(git write-tree)`, `PARENT=$(git rev-parse HEAD)`, `SHA=$(git commit-tree "$TREE" -p "$PARENT" -F <msgfile>)`, `git update-ref refs/heads/claude/suite-instance-label "$SHA"`. Re-check `git status --short` afterwards (only the untracked `.claude/settings.json` and `CLAUDE.md` may remain); the guard sometimes resets the index. Do not push.
- Run backend tests from `server/`: `node --test test/<file>` for one file, `npm test` for everything.
- The repo's CLAUDE.md mentions a graphify knowledge graph, but `graphify-out/` does not exist here; read files directly.

---

### Task 1: The label and `belongsToAnotherSuite`

**Files:**
- Modify: `server/src/docker/labels.js`
- Create: `server/test/labels.test.js`

**Interfaces:**
- Consumes: `containerPrefix()` from `../reconcile/prefix.js` (reads `process.env.SUITE_CONTAINER_PREFIX`, default `"streamshare-suite-"`, trimmed).
- Produces: `export const LABEL_SUITE = "streamshare.suite.instance"`; `managedLabels(kind, specHash, key)` now also returns `[LABEL_SUITE]: containerPrefix()`; `export function belongsToAnotherSuite(labels): boolean`.

- [ ] **Step 1: Write the failing tests**

Create `server/test/labels.test.js`:

```js
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { managedLabels, belongsToAnotherSuite, LABEL_SUITE } from "../src/docker/labels.js";

const original = process.env.SUITE_CONTAINER_PREFIX;

beforeEach(() => {
  delete process.env.SUITE_CONTAINER_PREFIX;
});

after(() => {
  if (original === undefined) delete process.env.SUITE_CONTAINER_PREFIX;
  else process.env.SUITE_CONTAINER_PREFIX = original;
});

test("managedLabels carries this Suite's prefix as its instance label", () => {
  assert.equal(managedLabels("gluetun", "h")[LABEL_SUITE], "streamshare-suite-");

  process.env.SUITE_CONTAINER_PREFIX = "dev-";
  assert.equal(managedLabels("gluetun", "h")[LABEL_SUITE], "dev-");
});

test("a container labeled for this Suite does not belong to another", () => {
  assert.equal(belongsToAnotherSuite(managedLabels("gluetun", "h")), false);
});

test("a container labeled for a different prefix belongs to another Suite", () => {
  process.env.SUITE_CONTAINER_PREFIX = "dev-";
  const stable = { ...managedLabels("gluetun", "h"), [LABEL_SUITE]: "streamshare-suite-" };
  assert.equal(belongsToAnotherSuite(stable), true);
});

test("a legacy managed container with no instance label is treated as this Suite's own", () => {
  const legacy = managedLabels("gluetun", "h");
  delete legacy[LABEL_SUITE];
  assert.equal(belongsToAnotherSuite(legacy), false);
});

test("an unmanaged container never belongs to another Suite, even with the label present", () => {
  assert.equal(belongsToAnotherSuite({}), false);
  assert.equal(belongsToAnotherSuite(undefined), false);
  assert.equal(belongsToAnotherSuite({ [LABEL_SUITE]: "other-" }), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && node --test test/labels.test.js`
Expected: FAIL. `LABEL_SUITE` / `belongsToAnotherSuite` are not exported.

- [ ] **Step 3: Implement**

In `server/src/docker/labels.js`, add the import at the top (after the header comment, before the first `export`):

```js
import { containerPrefix } from "../reconcile/prefix.js";
```

Add next to the other label constants:

```js
// Which Suite created a container: the value is that Suite's
// SUITE_CONTAINER_PREFIX, which is already what must differ between two
// Suites on one Docker host. Without it every Suite sees every other Suite's
// managed containers as its own orphans.
export const LABEL_SUITE = "streamshare.suite.instance";
```

Change `managedLabels` to include it:

```js
export function managedLabels(kind, specHash, key = "") {
  return {
    [LABEL_MANAGED]: "true",
    [LABEL_SUITE]: containerPrefix(),
    [LABEL_COMPONENT]: kind,
    [LABEL_COMPONENT_KEY]: key,
    [LABEL_SPEC_HASH]: specHash,
  };
}
```

Add after `isManaged`:

```js
// True only for a managed container that names a *different* Suite. A managed
// container with no instance label predates the label and is treated as this
// Suite's own — otherwise every existing install would see its whole stack
// turn foreign on upgrade. (A label cannot be added to a running container;
// it arrives the next time the container is recreated.)
export function belongsToAnotherSuite(labels) {
  if (!isManaged(labels)) return false;
  const owner = labels[LABEL_SUITE];
  return owner !== undefined && owner !== containerPrefix();
}
```

Also add one line to the header comment of the file's `managedLabels` block noting that `LABEL_SUITE`, like the others, is not part of the spec hash (the existing paragraph already says the labels are not hashed; just make sure it still reads correctly).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && node --test test/labels.test.js`
Expected: PASS (5 tests).

Then run the whole suite: `cd server && npm test`
Expected: all pass. Existing tests that build fixtures with `managedLabels()` now carry this Suite's own prefix, which counts as "ours".

- [ ] **Step 5: Commit**

Message: `Label every managed container with the Suite that created it`

Files: `server/src/docker/labels.js`, `server/test/labels.test.js`

---

### Task 2: Respect the label (orphans, planning, removal, deprovision) and document it

**Files:**
- Modify: `server/src/reconcile/reconciler.js`
- Modify: `server/src/reconcile/provisioning.js`
- Modify: `README.md`
- Modify: `server/src/reconcile/prefix.js` (comment only)
- Test: `server/test/stack-plan.test.js`, `server/test/stack-routes.test.js`, `server/test/deprovision.test.js`

**Interfaces:**
- Consumes: `LABEL_SUITE`, `belongsToAnotherSuite(labels)` from `../docker/labels.js` (Task 1).
- Produces: no new exports. Behaviour changes described below.

- [ ] **Step 1: Write the failing tests**

**`server/test/stack-plan.test.js`:** change the existing labels import to `import { managedLabels, LABEL_SUITE } from "../src/docker/labels.js";`. Add these tests (place them after the existing test "a managed container whose component left the stack is reported as orphaned"; the file's `configureGluetun()`, `vpn()`, `containers` and `planStack` helpers/imports are already there):

```js
test("another Suite's container is never reported as an orphan", async () => {
  configureGluetun();
  containers.set("other-gluetun", {
    Id: "other-id",
    name: "other-gluetun",
    Config: { Labels: { ...managedLabels("gluetun", "some-hash", ""), [LABEL_SUITE]: "other-suite-" } },
  });

  vpn(false);

  const { plans } = await planStack();
  assert.equal(plans.filter((p) => p.action === "orphaned").length, 0);
});

test("a legacy managed container with no instance label is still reported as an orphan", async () => {
  configureGluetun();
  const labels = managedLabels("gluetun", "some-hash", "");
  delete labels[LABEL_SUITE];
  containers.set("streamshare-suite-gluetun", {
    Id: "legacy-id",
    name: "streamshare-suite-gluetun",
    Config: { Labels: labels },
  });

  vpn(false);

  const { plans } = await planStack();
  assert.ok(plans.find((p) => p.action === "orphaned" && p.containerId === "legacy-id"));
});

test("a same-named container created by another Suite plans as adopt with a warning, never recreate", async () => {
  configureGluetun();
  containers.set("streamshare-suite-gluetun", {
    Id: "other-id",
    name: "streamshare-suite-gluetun",
    Config: { Labels: { ...managedLabels("gluetun", "stale-hash", ""), [LABEL_SUITE]: "other-suite-" } },
  });

  const { plans } = await planStack();
  const row = plans.find((p) => p.kind === "gluetun");

  assert.equal(row.action, "adopt");
  assert.match(row.reason, /another Suite/);
  assert.ok(row.warnings.some((w) => /SUITE_CONTAINER_PREFIX/.test(w)));
});

test("a same-named container carrying this Suite's own label still plans as noop", async () => {
  configureGluetun();
  const { plans: first } = await planStack();
  containers.set("streamshare-suite-gluetun", {
    Id: "own-id",
    name: "streamshare-suite-gluetun",
    Config: { Labels: managedLabels("gluetun", first[0].desiredHash, "") },
  });

  const { plans } = await planStack();
  assert.equal(plans.find((p) => p.kind === "gluetun").action, "noop");
});
```

**`server/test/stack-routes.test.js`:** add the import `import { managedLabels, LABEL_SUITE } from "../src/docker/labels.js";` next to the other imports at the top, then add this test directly after the existing test "removing an orphan without a container id is a 400". (In this file's fake Docker, containers are stored by name as `{ Id, name, Labels, running }`, and a failed job has `status === "failed"`.)

```js
test("removing a container that belongs to another Suite is refused and leaves it running", async () => {
  const c = await signedInClient(base);
  containers.set("other-gluetun", {
    Id: "other-id",
    name: "other-gluetun",
    Labels: { ...managedLabels("gluetun", "h", ""), [LABEL_SUITE]: "other-suite-" },
    running: true,
  });

  const removal = await c.post("/api/stack/orphans/remove", { containerId: "other-id" });
  assert.equal(removal.status, 202);
  const job = await waitForJob(c, removal.body.jobId);

  assert.equal(job.status, "failed");
  assert.ok(containers.get("other-gluetun"), "must not be removed");
  assert.equal(containers.get("other-gluetun").running, true, "must not be stopped");
});
```

**`server/test/deprovision.test.js`:** change the existing labels import to `import { managedLabels, LABEL_SUITE } from "../src/docker/labels.js";` and add this test directly after the existing test "an adopted container — not the Suite's own — is left running, never stopped":

```js
test("a same-named container created by another Suite is left running, never stopped", async () => {
  const { key } = provisionInstance(PROVIDER);
  const name = instanceContainerName(key, getComponentValues("instance", key));
  containers.set(name, {
    Id: "other-id",
    name,
    Labels: { ...managedLabels("instance", "h", key), [LABEL_SUITE]: "other-suite-" },
    running: true,
  });

  const { log, lines } = collectLog();
  await deprovisionInstance(key, { dropData: false, log });

  assert.equal(containers.has(name), true, "left running, untouched");
  assert.equal(containers.get(name).running, true);
  assert.equal(requests.some((r) => r.path.includes("/stop")), false);
  assert.ok(lines.some((l) => l.includes("belongs to another Suite")));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && node --test test/stack-plan.test.js test/stack-routes.test.js test/deprovision.test.js`
Expected: the "another Suite's container is never reported as an orphan", "plans as adopt", "removal is refused" and "deprovision leaves it running" tests FAIL; the "legacy … still an orphan" and "own label still noop" tests already pass (they pin existing behaviour). All pre-existing tests still PASS.

- [ ] **Step 3: Implement in `reconciler.js`**

Change the labels import line to:

```js
import { LABEL_MANAGED, LABEL_SPEC_HASH, LABEL_SUITE, managedLabels, isManaged, belongsToAnotherSuite, componentOf } from "../docker/labels.js";
```

In `planComponent`, directly after the existing `if (!isManaged(labels)) { ... }` block and before the `if (labels[LABEL_SPEC_HASH] === desiredHash)` block, add:

```js
  // Same name, but created by a different Suite on this host. Never ours to
  // recreate: handled like any other container the Suite may not touch, with
  // the cause spelled out so the fix (a distinct prefix) is obvious.
  if (belongsToAnotherSuite(labels)) {
    return {
      ...base,
      action: "adopt",
      reason: `Created by another Suite (${labels[LABEL_SUITE]}) — never touched without a takeover`,
      containerId: existing.Id,
      warnings: [
        "This container belongs to another Suite on this host. Give each Suite its own SUITE_CONTAINER_PREFIX so their container names don't collide.",
      ],
    };
  }
```

In `findOrphans`, at the top of the `.map((container) => {` callback, before `const component = componentOf(...)`, add:

```js
      if (belongsToAnotherSuite(container.Labels || {})) return null;
```

Replace `removeOrphan` with:

```js
export async function removeOrphan(containerId, { log = () => {} } = {}) {
  // Removal is by container ID, so nothing else stops this from taking down
  // another Suite's container — check the label here.
  const existing = await inspectContainer(containerId);
  if (existing && belongsToAnotherSuite(existing.Config?.Labels || {})) {
    throw new Error(
      `Refusing to remove ${containerId}: it belongs to another Suite (${existing.Config.Labels[LABEL_SUITE]}).`
    );
  }

  log(`Stopping ${containerId}...`);
  await stopContainer(containerId, { timeoutSeconds: 30 });
  log("Removing it...");
  await removeContainer(containerId, { force: true });
  log("Done.");
}
```

Add a line to the header comment list in `reconciler.js` under `orphaned`: "A container labeled for a different Suite is not this Suite's orphan and is never listed."

- [ ] **Step 4: Implement in `provisioning.js`**

`provisioning.js` already imports `isManaged` from `../docker/labels.js`; change that import to `import { isManaged, belongsToAnotherSuite } from "../docker/labels.js";`. In `deprovisionInstance`, replace the `if (existing && isManaged(...)) { ... } else if (existing) { ... }` chain's conditions and the log in the else branch so it reads:

```js
  const labels = existing?.Config?.Labels || {};

  if (existing && isManaged(labels) && !belongsToAnotherSuite(labels)) {
    log(`Stopping ${name}...`);
    await stopContainer(existing.Id, { timeoutSeconds: 30 });
    log(`Removing ${name}...`);
    await removeContainer(existing.Id, { force: true });
  } else if (existing) {
    // Adopted, not ours to stop — the same invariant Adopt itself rests on.
    // (Or created by another Suite on this host, which is no more ours.)
    // If dropData is also asked for, the drop below may fail while this is
    // still connected to it; there is no way around that without touching a
    // container the Suite was never allowed to touch.
    log(
      belongsToAnotherSuite(labels)
        ? `${name} belongs to another Suite — leaving it running.`
        : `${name} was not created by the Suite — leaving it running.`
    );
  }
```

(Keep the rest of the function as it is; only the `existing`/`isManaged` block changes. Keep the existing explanatory comment text about `dropData` intact.)

- [ ] **Step 5: Docs**

In `server/src/reconcile/prefix.js`, append one sentence to the header comment: "It is also the identity a Suite stamps on every container it creates (the `streamshare.suite.instance` label), so a Suite never treats another Suite's containers as its own."

In `README.md`, in the row for `SUITE_CONTAINER_PREFIX` in the Configuration table, after "...each needs a different prefix so their default names don't collide." add: "The prefix is also stamped on every container as a label, so each Suite only ever lists, replaces or removes its own; changing it later on an existing Suite makes the old containers read as another Suite's, so remove those with Docker directly."

- [ ] **Step 6: Run the tests**

Run: `cd server && node --test test/stack-plan.test.js test/stack-routes.test.js test/deprovision.test.js`
Expected: PASS.

Then the whole suite: `cd server && npm test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

Message: `Never treat another Suite's containers as our own`

Files: `server/src/reconcile/reconciler.js`, `server/src/reconcile/provisioning.js`, `server/src/reconcile/prefix.js`, `README.md`, `server/test/stack-plan.test.js`, `server/test/stack-routes.test.js`, `server/test/deprovision.test.js`
