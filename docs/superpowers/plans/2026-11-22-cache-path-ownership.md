# Cache Folder Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an instance's custom cache path is missing (or empty and root-owned) on the host, the Suite gives it to PUID:PGID before the instance starts.

**Architecture:** `prepareInstance` runs a one-shot helper container (the instance's own image, as root, cache path bound to `/cache`) that chowns the folder only when it is `0:0` and empty, waits for it, and removes it. A new `waitContainer` Docker client call supports this. Helper failures become a warning, never a failed apply.

**Tech Stack:** Node ≥22 ESM, Docker Engine API v1.43 via the socket proxy, `node:test` with a fake HTTP Docker daemon (pattern: `server/test/deprovision.test.js`, `server/test/docker-client.test.js`).

**Spec:** `docs/superpowers/specs/2026-11-22-cache-path-ownership-design.md`

## Global Constraints

- Never chown a folder that is non-empty or owned by anything but `0:0`. Never recursive.
- Instances keep running as PUID:PGID; no StreamShare image change; no socket proxy grant change.
- Only for caching on **and** a non-blank `cachePath`. Blank path: unchanged behaviour.
- Helper failure: apply logs `Warning: could not prepare the cache folder <path>: <error>` and continues.
- Success log, only when ownership changed: `Gave the new cache folder <path> to <uid>:<gid>.`
- Bind via `HostConfig.Binds`, never `HostConfig.Mounts`: only `Binds` makes the daemon create a missing source folder; `Mounts` type=bind errors instead.
- Skip the helper entirely when `ownership()` is `null` or is `0:0` (Suite runs as root, nothing to fix).
- Nothing private (instance/provider names, host paths of the owner's setup) in code, tests or commits.

## Review Focus

- Existing folder with files in it, owned by root → left alone, no log line, apply continues — test in Task 2 (exit code 0 path).
- Helper exits non-zero/non-10 (chown failed, no `sh` in a custom image) → warning, apply continues — test in Task 2.
- A helper left behind by a crashed earlier apply (same name) → removed before creating the new one, not a "name already in use" error — test in Task 2.
- Helper container is always removed, even when wait fails — test in Task 2.
- Path with spaces → passed as a single bind (`Binds` entry), never interpolated into the shell script — reviewer checks; the script only ever sees `/cache`.

---

### Task 1: `waitContainer` in the Docker client

**Files:**
- Modify: `server/src/docker/client.js`
- Test: `server/test/docker-client.test.js`

**Interfaces:**
- Produces: `waitContainer(idOrName: string, { timeoutMs = 60000 } = {}) -> Promise<number>` — `POST /containers/{id}/wait`, resolves to the body's `StatusCode`; non-200 throws `DockerError` via `parseJsonOrThrow`.

- [ ] **Step 1: Write the failing test** (append to `docker-client.test.js`, using its `queue`/`json`/`client` helpers)

```js
test("waitContainer posts to /wait and returns the exit code", async () => {
  queue((res) => json(res, 200, { StatusCode: 10 }));
  const { waitContainer } = await client();
  assert.equal(await waitContainer("helper"), 10);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].path, "/v1.43/containers/helper/wait");
});

test("waitContainer throws on a missing container", async () => {
  queue((res) => json(res, 404, { message: "No such container: helper" }));
  const { waitContainer } = await client();
  await assert.rejects(waitContainer("helper"), /No such container: helper/);
});
```

- [ ] **Step 2: Run to verify it fails** — `cd server && node --test test/docker-client.test.js` → FAIL, `waitContainer` not exported.
- [ ] **Step 3: Implement `waitContainer`** next to `stopContainer`, passing `timeoutMs` to `request`.
- [ ] **Step 4: Run** — same command → PASS.
- [ ] **Step 5: Commit** (simplify review first; the repo hook blocks the commit otherwise)

```bash
git add server/src/docker/client.js server/test/docker-client.test.js
git commit -m "feat(docker): add waitContainer"
```

### Task 2: Prepare the cache folder before an instance starts

**Files:**
- Create: `server/src/reconcile/cacheFolder.js`
- Modify: `server/src/reconcile/instance.js` (export two helpers, use them in `renderInstanceSpec`)
- Modify: `server/src/reconcile/provisioning.js` (`prepareInstance`)
- Modify: `server/src/schema/instance.js` (`cachePath` help text)
- Create: `server/test/cache-folder.test.js`

**Interfaces:**
- Consumes: `waitContainer` (Task 1); existing `createContainer`, `startContainer`, `removeContainer`, `ownership()`, `instanceContainerName(key, values)`.
- Produces:
  - `instance.js`: `instanceImage(values) -> string` (`values.image ||` the schema field's default, replacing the literal at line 201) and `customCachePath(values) -> string | null` (trimmed `cachePath` when caching is on — VOD, catchup or disk catalogue — else `null`; `renderInstanceSpec` uses it for `cacheDir`).
  - `cacheFolder.js`: `prepareCacheFolder(key, values, { log = () => {} } = {}) -> Promise<void>` — never throws.
  - `prepareInstance` calls `prepareCacheFolder` first, **before** its `if (!values._dbName) return;`.

- [ ] **Step 1: Write the failing tests** in `server/test/cache-folder.test.js`. Fake Docker daemon as in `deprovision.test.js`: records requests; `POST /containers/create` → 201 `{Id:"h1"}` (or 409 if a container with that name is still in its map); `POST .../start` → 204; `POST .../wait` → 200 `{StatusCode: nextExit}`; `DELETE` → 204. Use `freshDatabase()` and set `process.getuid`/`getgid` only if needed to make `ownership()` non-root (or stub `ownership` via the test's chosen approach). Tests:

```js
test("creates the helper as root with the cache path bound and our ids in the script", async () => {
  nextExit = 10;
  await prepareCacheFolder("cache-test", values({ cachePath: "/mnt/cache dir/x" }), { log });
  const create = requests.find((r) => r.method === "POST" && r.path.endsWith("/containers/create"));
  assert.equal(create.query.get("name"), `${instanceContainerName("cache-test", v)}-cache-init`);
  assert.equal(create.body.User, "0:0");
  assert.deepEqual(create.body.HostConfig.Binds, ["/mnt/cache dir/x:/cache"]);
  assert.deepEqual(create.body.Entrypoint, ["sh", "-c"]);
  assert.match(create.body.Cmd[0], new RegExp(`chown ${uid}:${gid} /cache`));
  assert.ok(!create.body.Cmd[0].includes("/mnt/cache dir/x"));
  assert.deepEqual(lines, [`Gave the new cache folder /mnt/cache dir/x to ${uid}:${gid}.`]);
  assert.ok(requests.some((r) => r.method === "DELETE"));
});

test("an existing folder (exit 0) is left alone silently", ...);         // lines === []
test("a failing helper logs a warning and does not throw", ...);          // nextExit = 1 -> lines[0] starts with "Warning: could not prepare the cache folder"
test("a failed wait still removes the helper and only warns", ...);       // wait -> 500; DELETE seen; no throw
test("a leftover helper from an earlier apply is removed first", ...);    // pre-seed container map with the helper name; DELETE before create; succeeds
test("blank cache path or caching off runs no helper", ...);              // requests.length === 0 for both
```

`values({...})` = an instance's stored values with `vodCacheEnabled: "true"` plus overrides; `v` the same object.

- [ ] **Step 2: Run to verify it fails** — `cd server && node --test test/cache-folder.test.js` → FAIL, module missing.
- [ ] **Step 3: Implement.** The helper's script, fixed (ids from `ownership()`; exit 10 means "changed"):

```sh
[ "$(stat -c %u:%g /cache)" = 0:0 ] && [ -z "$(ls -A /cache)" ] || exit 0
chown UID:GID /cache && exit 10
```

  Flow: skip unless `customCachePath(values)` and a non-root `ownership()`; `removeContainer(name, { force: true })`; `createContainer(name, { Image: instanceImage(values), User: "0:0", Entrypoint: ["sh", "-c"], Cmd: [script], HostConfig: { Binds: [`${path}:/cache`] } })` — no managed labels, so plans never see it; `startContainer`; `waitContainer`; exit 10 → success line, 0 → nothing, other → warning `exited with code N`; any thrown error → warning; `finally` remove the helper (ignore its errors). One line comment for why exit 10 (signals "changed" without reading logs, which the proxy does not grant).
  Update `cachePath` help: drop "The Suite does not create or check a path you enter: it must already exist ... Docker creates a missing folder as root, and the instance could not write to it."; replace with: "If the folder does not exist yet, the Suite creates it owned by PUID/PGID from the Suite's compose file. An existing folder keeps its owner, so it must be writable for that user."
- [ ] **Step 4: Run** — `cd server && node --test test/cache-folder.test.js && npm test` → all PASS (existing instance render tests must still pass with `instanceImage`/`customCachePath`).
- [ ] **Step 5: Commit** (simplify review first)

```bash
git add server/src/reconcile/cacheFolder.js server/src/reconcile/instance.js server/src/reconcile/provisioning.js server/src/schema/instance.js server/test/cache-folder.test.js
git commit -m "fix(instance): give a new cache folder to PUID:PGID instead of root"
```

### Task 3: End-to-end check on the dev stack

No code.

- [ ] **Step 1:** Build a dev image: `gh workflow run dev-build.yml --ref fix/cache-path-ownership -R x3n0n10/stream-share-suite`; compose on `:dev`; `docker compose pull && docker compose up -d`.
- [ ] **Step 2:** Set the dev instance's cache path to a non-existent folder under `/home/user/suite-dev/cache-test/new`, enable VOD cache, apply. Expected: log line `Gave the new cache folder ... to 1000:1000.`; `stat -c %u:%g` on the host shows `1000:1000`; instance healthy; no `*-cache-init` container left (`docker ps -a`).
- [ ] **Step 3:** Put a file in a root-owned folder (`docker run --rm -v ...:/w alpine sh -c 'mkdir -p /w/full && touch /w/full/f'`), point the cache path there, apply. Expected: no "Gave" line; folder still `0:0`.
- [ ] **Step 4:** Report both results in the PR.
