# Setup Wizard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Setup wizard's infrastructure-first flow (VPN → gluetun → PostgreSQL → one instance) with an instance-first flow (instances → shared caching → database → external access/Discord → VPN → health check), and add the small backend capabilities (Discord fields, explicit per-instance cache paths) it needs along the way.

**Architecture:** Two backend schema/reconciler changes land first (Discord fields, cache-path-replaces-`SUITE_CACHE_DIR`), each independently testable via the server's `node --test` suite. The wizard itself becomes one file per step under `web/src/pages/setup/`, orchestrated by a slim `Setup.jsx` holding the current step index and the list of instances created this run. Steps that reuse an existing component's schema render `SchemaForm` with a client-side filtered subset of fields; steps with no existing schema counterpart (caching, the access-mode chooser) are hand-built.

**Tech Stack:** Node.js (`node --test`, no extra test framework) on the server; React + Vite + Tailwind on the client, with no frontend test runner configured in this repo — frontend tasks are verified by `npm run build` (catches import/type errors) plus a described manual browser check, not automated tests.

## Global Constraints

- Every commit message ends with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` (this repo's existing convention).
- Server tests: `cd server && npm test` (runs `node --test "test/*.test.js"`). Run the whole suite after every backend task, not just the new test — several existing tests exercise shared code this plan touches (`registry.js`, `reconcile/catalog.js`, `store/paths.js`).
- Frontend: `cd web && npm run build` after every frontend task. There is no `npm test` in `web/package.json` — do not invent one; this plan does not introduce a test framework.
- Match existing code style exactly: comments explain *why*, not *what*; no comment is added unless it captures a non-obvious constraint (see any existing file in this repo for the standard).
- Never leave a field, function, or file half-migrated at the end of a task — each task's diff must leave the repo in a state where `npm test` (server) or `npm run build` (web) passes.
- Reuse existing conventions: `type: "select"` with `["true","false"]` options for env-var-backed booleans that appear in this repo's env var contract (`vodCacheEnabled`, `catchupEnabled`), `type: "checkbox"` for booleans with no such contract (`discordEnabled`, matching `healthCheckEnabled`).

---

## File Structure

**Backend (modified, no new files except tests already existing):**
- `server/src/schema/registry.js` — adds OR (`any`) support to the shared `dependsOn`/`requiredWhen` condition evaluator.
- `server/src/schema/instance.js` — adds the `Discord` field group, `cachePath`, and `publicBaseUrl`'s new `requiredWhen`; flips `vodCacheEnabled`'s default.
- `server/src/reconcile/instance.js` — makes the cache volume conditional, computes `DISCORD_API_URL`.
- `server/src/reconcile/catalog.js` — the instance kind's `ready` becomes a function of that instance's own values instead of a global path check.
- `server/src/reconcile/reconciler.js` — passes the already-resolved `values` into `node.ready(...)`.
- `server/src/store/paths.js` — removes `getCachePath`/`componentCacheDir`, now dead.
- `server/test/registry.test.js`, `server/test/instance.test.js`, `server/test/paths.test.js`, `server/test/caddy.test.js`, `server/test/import.test.js` — updated/added tests.
- `docker-compose.yml`, `README.md` — remove `SUITE_CACHE_DIR`.

**Frontend (new step files + one extracted helper):**
- `web/src/lib/applyToAll.js` — new. Extracts `describeFailures` out of `Aliases.jsx` so the wizard's multi-instance steps and `Aliases.jsx` share one implementation.
- `web/src/pages/setup/StepInstances.jsx` — new.
- `web/src/pages/setup/StepCaching.jsx` — new.
- `web/src/pages/setup/StepDatabase.jsx` — new.
- `web/src/pages/setup/StepExternalAccess.jsx` — new.
- `web/src/pages/setup/StepVpn.jsx` — new.
- `web/src/pages/setup/StepHealthCheck.jsx` — new.
- `web/src/pages/setup/StepDone.jsx` — new.
- `web/src/pages/Setup.jsx` — rewritten into a slim orchestrator.
- `web/src/pages/Aliases.jsx` — modified to import `describeFailures` instead of defining it locally.

---

## Task 1: Schema registry — OR (`any`) condition support

**Files:**
- Modify: `server/src/schema/registry.js:28-53` (the `conditionMet`/`isVisible`/`isRequired` trio)
- Test: `server/test/registry.test.js`

**Interfaces:**
- Consumes: nothing new — this is the lowest layer.
- Produces: `conditionMet(condition, values, schema)` — a new internal signature (was `conditionMet(condition, depValue)`). `isVisible`/`isRequired` keep their existing external signatures; every existing schema's `dependsOn`/`requiredWhen` (single condition, `oneOf`, or an AND-array) keeps working unchanged. A condition may now also be `{ any: [condition, ...] }`, satisfied when at least one sub-condition matches.

- [ ] **Step 1: Write the failing test**

Add to `server/test/registry.test.js` (after the existing `"a select holding a value outside its options is rejected even when optional"` test, at the end of the file):

```js
test("dependsOn's any form is satisfied when at least one sub-condition matches", () => {
  const schema = {
    kind: "cache",
    label: "Cache",
    fields: [
      { key: "vodCacheEnabled", envVar: null, label: "VOD cache", type: "checkbox", default: false },
      { key: "catchupEnabled", envVar: null, label: "Catchup", type: "checkbox", default: false },
      {
        key: "cachePath",
        envVar: null,
        label: "Cache path",
        required: true,
        dependsOn: {
          any: [
            { key: "vodCacheEnabled", equals: true },
            { key: "catchupEnabled", equals: true },
          ],
        },
      },
    ],
  };

  // Neither flag on: hidden, so not reported missing even though required.
  assert.equal(validate(schema, {}).some((e) => e.key === "cachePath"), false);

  // Catchup alone satisfies the "any": visible and required.
  assert.equal(validate(schema, { catchupEnabled: true }).some((e) => e.key === "cachePath"), true);

  // VOD cache alone also satisfies it.
  assert.equal(validate(schema, { vodCacheEnabled: true }).some((e) => e.key === "cachePath"), true);

  // Both on, value supplied: satisfied.
  assert.equal(
    validate(schema, { vodCacheEnabled: true, catchupEnabled: true, cachePath: "/mnt/cache" }).some(
      (e) => e.key === "cachePath"
    ),
    false
  );
});

test("requiredWhen's any form works the same way as dependsOn's", () => {
  const schema = {
    kind: "db",
    label: "DB",
    fields: [
      { key: "modeA", envVar: null, label: "A", type: "checkbox", default: false },
      { key: "modeB", envVar: null, label: "B", type: "checkbox", default: false },
      {
        key: "password",
        envVar: null,
        label: "Password",
        required: true,
        requiredWhen: {
          any: [
            { key: "modeA", equals: true },
            { key: "modeB", equals: true },
          ],
        },
      },
    ],
  };

  // Always visible (no dependsOn) — but not required until one mode is on.
  assert.equal(validate(schema, {}).some((e) => e.key === "password"), false);
  assert.equal(validate(schema, { modeA: true }).some((e) => e.key === "password"), true);
  assert.equal(validate(schema, { modeB: true }).some((e) => e.key === "password"), true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npm test`
Expected: FAIL — both new tests fail because `cachePath`/`password` are reported required in the "neither flag on" case (the `any` key is not understood yet, so `conditionMet` falls through to `depValue === condition.equals` with `depValue` and `condition.equals` both `undefined`, which is `true` — the condition is wrongly treated as met).

- [ ] **Step 3: Implement the `any` form**

Replace `server/src/schema/registry.js` lines 28-53 (the `resolvedValue` function stays as-is above this range; replace from `function conditionMet` through the end of `isVisible`) with:

```js
// Checked against the referenced field's *resolved* value (default applied),
// not the raw stored one — otherwise a field whose visibility depends on
// another field's default would incorrectly read as hidden until that other
// field had actually been saved once.
//
// A condition is either a leaf ({ key, equals } or { key, oneOf }) or an
// { any: [...] } group, satisfied when at least one of its own conditions
// is — e.g. a cache path that's only relevant when VOD caching *or* catchup
// is on. Leaves and groups can nest arbitrarily since this recurses on
// whichever shape it's handed; nothing here assumes only one level of "any".
function conditionMet(condition, values, schema) {
  if ("any" in condition) {
    return condition.any.some((sub) => conditionMet(sub, values, schema));
  }
  const depField = schema.fields.find((f) => f.key === condition.key);
  const depValue = depField ? resolvedValue(depField, values) : values[condition.key];
  if ("oneOf" in condition) return condition.oneOf.includes(depValue);
  return depValue === condition.equals;
}

function isVisible(field, values, schema) {
  if (!field.dependsOn) return true;
  const conditions = Array.isArray(field.dependsOn) ? field.dependsOn : [field.dependsOn];
  return conditions.every((condition) => conditionMet(condition, values, schema));
}
```

And replace `isRequired`'s body (keep its signature) so it also delegates to the new `conditionMet`:

```js
function isRequired(field, values, schema) {
  if (!field.required) return false;
  if (!field.requiredWhen) return true;

  const conditions = Array.isArray(field.requiredWhen) ? field.requiredWhen : [field.requiredWhen];
  return conditions.every((condition) => conditionMet(condition, values, schema));
}
```

Also update the file's top-of-file doc comment (currently ending at line 26 with `... { key: "vpnServiceProvider", oneOf: ["mullvad"] }].`) by appending one line after it:

```js
//
// A condition can also be { any: [condition, ...] } — satisfied when at
// least one of those conditions is, e.g. a field required when either of
// two independent toggles is on.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npm test`
Expected: PASS — all tests in `registry.test.js` pass, including the two new ones. Specifically confirm no regression in the pre-existing `"validate only requires a field when every condition in an array dependsOn is met"` test — the AND-array behavior must be byte-for-byte the same as before.

- [ ] **Step 5: Commit**

```bash
cd server
git add src/schema/registry.js test/registry.test.js
git commit -m "$(cat <<'EOF'
Add OR (any) support to schema dependsOn/requiredWhen conditions

Needed for a field required when either of two independent toggles is
on (an instance's cache path, coming next) — the existing mechanism
only supports ANDing multiple conditions together.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Instance schema — Discord fields

**Files:**
- Modify: `server/src/schema/instance.js` (the `Access` group's neighbor — insert a new `Discord` group after the `Addressing` group; modify the existing `publicBaseUrl` field in `Addressing`)
- Test: `server/test/instance.test.js`

**Interfaces:**
- Consumes: `INSTANCE_SCHEMA.fields` (existing export), `validate`/`renderEnv` from `registry.js` (Task 1, unchanged external signatures).
- Produces: three new field keys on `INSTANCE_SCHEMA` — `discordEnabled` (checkbox), `discordBotToken` (secret text, envVar `DISCORD_BOT_TOKEN`), `discordAdminRoleId` (text, envVar `DISCORD_ADMIN_ROLE_ID`). `publicBaseUrl` gains `required: true` and `requiredWhen: { key: "discordEnabled", equals: true }`.

- [ ] **Step 1: Write the failing test**

Add to `server/test/instance.test.js`. First add this import alongside the existing ones (after the `freshDatabase` import on line 28):

```js
import { INSTANCE_SCHEMA } from "../src/schema/instance.js";
import { validate, renderEnv } from "../src/schema/registry.js";
```

Then add these tests after the last existing test in the file (after the `"an instance with no database configured at all is blocked before it can fail on connect"` test):

```js
// --- Discord fields ----------------------------------------------------

test("discordBotToken is required only once discordEnabled is on", () => {
  const base = { ...PROVIDER, publicBaseUrl: "https://tv.example.com/p1" };
  assert.equal(validate(INSTANCE_SCHEMA, base).some((e) => e.key === "discordBotToken"), false);
  assert.equal(
    validate(INSTANCE_SCHEMA, { ...base, discordEnabled: true }).some((e) => e.key === "discordBotToken"),
    true
  );
  assert.equal(
    validate(INSTANCE_SCHEMA, { ...base, discordEnabled: true, discordBotToken: "tok" }).some(
      (e) => e.key === "discordBotToken"
    ),
    false
  );
});

test("publicBaseUrl becomes required once discordEnabled is on, optional otherwise", () => {
  assert.equal(validate(INSTANCE_SCHEMA, PROVIDER).some((e) => e.key === "publicBaseUrl"), false);
  assert.equal(
    validate(INSTANCE_SCHEMA, { ...PROVIDER, discordEnabled: true, discordBotToken: "tok" }).some(
      (e) => e.key === "publicBaseUrl"
    ),
    true
  );
});

test("renderEnv only emits DISCORD_BOT_TOKEN/DISCORD_ADMIN_ROLE_ID when discordEnabled is on", () => {
  const off = renderEnv(INSTANCE_SCHEMA, PROVIDER);
  assert.equal("DISCORD_BOT_TOKEN" in off, false);
  assert.equal("DISCORD_ADMIN_ROLE_ID" in off, false);

  const on = renderEnv(INSTANCE_SCHEMA, {
    ...PROVIDER,
    discordEnabled: true,
    discordBotToken: "tok",
    discordAdminRoleId: "role-1",
  });
  assert.equal(on.DISCORD_BOT_TOKEN, "tok");
  assert.equal(on.DISCORD_ADMIN_ROLE_ID, "role-1");
});

test("renderEnv omits DISCORD_ADMIN_ROLE_ID when left blank, even with Discord on", () => {
  const env = renderEnv(INSTANCE_SCHEMA, { ...PROVIDER, discordEnabled: true, discordBotToken: "tok" });
  assert.equal("DISCORD_ADMIN_ROLE_ID" in env, false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npm test`
Expected: FAIL — `discordBotToken`/`discordEnabled`/`discordAdminRoleId` don't exist on `INSTANCE_SCHEMA` yet, so `validate`/`renderEnv` never mention them; the `publicBaseUrl` test fails because it has no `requiredWhen` yet.

- [ ] **Step 3: Add the fields**

In `server/src/schema/instance.js`, replace the existing `publicBaseUrl` field (in the `--- how it is reached ---` section) from:

```js
    {
      key: "publicBaseUrl",
      envVar: "PUBLIC_BASE_URL",
      label: "Public base URL",
      help: "The address your users' players reach this instance at, e.g. https://tv.example.com/provider-1. Leave blank if it is not published externally.",
      group: "Addressing",
    },
```

to:

```js
    {
      key: "publicBaseUrl",
      envVar: "PUBLIC_BASE_URL",
      label: "Public base URL",
      help: "The address your users' players reach this instance at, e.g. https://tv.example.com/provider-1. Leave blank if it is not published externally.",
      group: "Addressing",
      required: true,
      requiredWhen: { key: "discordEnabled", equals: true },
    },
```

Then, immediately after the `--- how it is reached ---` section's `timezone` field and before the `--- caching ---` section comment, insert a new group:

```js

    // --- Discord --------------------------------------------------------
    //
    // DISCORD_API_URL is deliberately not a field: it's the same address
    // Discord needs to reach this instance at, which is exactly what
    // publicBaseUrl already says — see reconcile/instance.js, which computes
    // it from that field rather than asking a second time.
    {
      key: "discordEnabled",
      envVar: null,
      label: "Enable Discord bot",
      type: "checkbox",
      default: false,
      group: "Discord",
    },
    {
      key: "discordBotToken",
      envVar: "DISCORD_BOT_TOKEN",
      label: "Bot token",
      group: "Discord",
      secret: true,
      required: true,
      dependsOn: { key: "discordEnabled", equals: true },
    },
    {
      key: "discordAdminRoleId",
      envVar: "DISCORD_ADMIN_ROLE_ID",
      label: "Admin role ID",
      help: "Optional. A Discord role ID granted admin-level bot commands.",
      group: "Discord",
      advanced: true,
      dependsOn: { key: "discordEnabled", equals: true },
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npm test`
Expected: PASS — all four new tests pass, and the full suite (including `stack-routes.test.js`, which exercises instance creation/validation through the HTTP layer) still passes since nothing existing depended on `publicBaseUrl` being optional.

- [ ] **Step 5: Commit**

```bash
cd server
git add src/schema/instance.js test/instance.test.js
git commit -m "$(cat <<'EOF'
Add Discord fields to the instance schema

discordEnabled/discordBotToken/discordAdminRoleId, plus publicBaseUrl
becoming required once Discord is on — DISCORD_API_URL is computed from
it rather than asked for twice (next task wires that into
reconcile/instance.js).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Instance schema — cache path, and the `vodCacheEnabled` default flip

**Files:**
- Modify: `server/src/schema/instance.js` (the `--- caching ---` and `--- the container itself ---` sections)
- Test: `server/test/instance.test.js`

**Interfaces:**
- Consumes: `conditionMet`'s `any` form (Task 1).
- Produces: `cachePath` field on `INSTANCE_SCHEMA` (group `Container`, `dependsOn`/effectively-required via the `any` of `vodCacheEnabled`/`catchupEnabled`). `vodCacheEnabled`'s `default` changes from `"true"` to `"false"`.

- [ ] **Step 1: Write the failing test**

Add to `server/test/instance.test.js`, after the Discord tests added in Task 2:

```js
// --- cache path ----------------------------------------------------------

test("vodCacheEnabled now defaults to off", () => {
  const fields = INSTANCE_SCHEMA.fields;
  assert.equal(fields.find((f) => f.key === "vodCacheEnabled").default, "false");
});

test("cachePath is not required while both caching flags are off", () => {
  assert.equal(validate(INSTANCE_SCHEMA, PROVIDER).some((e) => e.key === "cachePath"), false);
});

test("cachePath is required once VOD caching is on", () => {
  const errors = validate(INSTANCE_SCHEMA, { ...PROVIDER, vodCacheEnabled: "true" });
  assert.equal(errors.some((e) => e.key === "cachePath"), true);
});

test("cachePath is required once catchup is on, independently of VOD caching", () => {
  const errors = validate(INSTANCE_SCHEMA, { ...PROVIDER, catchupEnabled: "true" });
  assert.equal(errors.some((e) => e.key === "cachePath"), true);
});

test("cachePath satisfied with either caching flag on and a value given", () => {
  const errors = validate(INSTANCE_SCHEMA, {
    ...PROVIDER,
    vodCacheEnabled: "true",
    cachePath: "/mnt/cache/provider-1",
  });
  assert.equal(errors.some((e) => e.key === "cachePath"), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npm test`
Expected: FAIL — `cachePath` doesn't exist on the schema yet (never reported required in any case), and `vodCacheEnabled`'s default is still `"true"`.

- [ ] **Step 3: Add the field and flip the default**

In `server/src/schema/instance.js`, change `vodCacheEnabled`'s `default` from `"true"` to `"false"`:

```js
    {
      key: "vodCacheEnabled",
      envVar: "VOD_CACHE_ENABLED",
      label: "Cache VOD locally",
      type: "select",
      options: ["true", "false"],
      default: "false",
      group: "Caching",
      advanced: true,
    },
```

Then, in the `--- the container itself ---` section, insert `cachePath` right after `port` and before `extraEnv`:

```js
    {
      key: "cachePath",
      envVar: null,
      label: "Cache location on the host",
      help: "Where this instance's VOD/catchup cache lives on the Docker host. Required once VOD caching or catchup is turned on above — there's no default, since it always has to be a path that actually exists and is writable on this specific host.",
      group: "Container",
      required: true,
      dependsOn: {
        any: [
          { key: "vodCacheEnabled", equals: "true" },
          { key: "catchupEnabled", equals: "true" },
        ],
      },
    },
```

(No separate `requiredWhen` needed: `validate` already skips a field entirely once `dependsOn` hides it, so `required: true` alone means "required whenever shown" — see `registry.js`'s `validate`, which calls `continue` on a hidden field before `isRequired` is ever consulted.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npm test`
Expected: PASS — all five new tests pass. Also re-run the full suite and specifically check `instance.test.js`'s pre-existing `"an instance with no usable stack paths is incomplete rather than mis-mounted"` test still passes unmodified — it should, since `PROVIDER` never sets `vodCacheEnabled`/`catchupEnabled`, both now resolve to `"false"` by default, so `cachePath` stays hidden and irrelevant to that test.

- [ ] **Step 5: Commit**

```bash
cd server
git add src/schema/instance.js test/instance.test.js
git commit -m "$(cat <<'EOF'
Add explicit per-instance cachePath; default caching to off

cachePath is required exactly when VOD caching or catchup is on for
that instance, with no computed default (the shared SUITE_CACHE_DIR
mechanism goes away in a following task). vodCacheEnabled now defaults
to off so an instance created outside the wizard isn't silently
caching before anyone's chosen a path for it.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Conditional cache mount + computed `DISCORD_API_URL`

**Files:**
- Modify: `server/src/reconcile/instance.js:83-147` (`renderInstanceSpec`)
- Test: `server/test/instance.test.js`

**Interfaces:**
- Consumes: `values.cachePath`, `values.vodCacheEnabled`, `values.catchupEnabled`, `values.discordEnabled`, `values.publicBaseUrl` (all from Tasks 2-3's schema additions).
- Produces: `renderInstanceSpec(values, key)` — same signature, but its returned `spec.volumes` omits the cache mount when neither caching flag is on, and its `env` includes `DISCORD_API_URL` (computed, mirroring `publicBaseUrl`) exactly when `discordEnabled` is true.

- [ ] **Step 1: Write the failing test**

Add to `server/test/instance.test.js`, in the `--- the two topologies ---` section (after the existing `"an overridden container name is what the spec and the URL both use"` test):

```js
test("an instance with no caching enabled gets no cache volume at all", async () => {
  configureStack();
  vpn(false);
  const { key } = provisionInstance(PROVIDER);

  const spec = await renderInstanceSpec(getComponentValues("instance", key), key);

  assert.equal(spec.volumes.some((v) => v.endsWith(":/cache")), false);
  assert.equal(spec.volumes.some((v) => v.endsWith(":/root")), true, "the config mount is still there");
});

test("an instance with VOD caching on gets a cache volume from its own cachePath", async () => {
  configureStack();
  vpn(false);
  const cacheDir = mkdtempSync(path.join(tmpdir(), "suite-instance-cache-"));
  const { key } = provisionInstance({ ...PROVIDER, vodCacheEnabled: "true", cachePath: cacheDir });

  const spec = await renderInstanceSpec(getComponentValues("instance", key), key);

  assert.ok(spec.volumes.includes(`${cacheDir}:/cache`));
  rmSync(cacheDir, { recursive: true, force: true });
});

test("Discord on computes DISCORD_API_URL from publicBaseUrl rather than asking for it twice", async () => {
  configureStack();
  vpn(false);
  const { key } = provisionInstance({
    ...PROVIDER,
    publicBaseUrl: "https://tv.example.com/provider-1",
    discordEnabled: true,
    discordBotToken: "tok",
  });

  const spec = await renderInstanceSpec(getComponentValues("instance", key), key);

  assert.equal(spec.env.DISCORD_API_URL, "https://tv.example.com/provider-1");
  assert.equal(spec.env.DISCORD_BOT_TOKEN, "tok");
});

test("Discord off means no DISCORD_API_URL, even with a public base URL set", async () => {
  configureStack();
  vpn(false);
  const { key } = provisionInstance({ ...PROVIDER, publicBaseUrl: "https://tv.example.com/provider-1" });

  const spec = await renderInstanceSpec(getComponentValues("instance", key), key);

  assert.equal("DISCORD_API_URL" in spec.env, false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npm test`
Expected: FAIL — the cache volume is currently always present regardless of caching flags (first test fails), and `DISCORD_API_URL` is never set today (third test fails; fourth test passes already since nothing turns it on, but keep it — it's the sibling case that must keep passing after the change).

- [ ] **Step 3: Implement**

In `server/src/reconcile/instance.js`, replace the body of `renderInstanceSpec` from its start through the `volumes` line. The current text (lines 83-132):

```js
export async function renderInstanceSpec(values, key) {
  const name = instanceContainerName(key, values);
  const port = Number(values.port);

  const configDir = ensureDirectory(componentDataDir(name), "config");
  const cacheDir = ensureDirectory(componentCacheDir(name));

  const env = {
    ...parseExtraEnv(values.extraEnv),
    ...renderEnv(INSTANCE_SCHEMA, values),
  };

  // Computed rather than asked for — see the schema's header for why each one
  // is not a field.
  env.PORT = String(port);
  env.INSTANCE_NAME = values.displayName || key;
  env.CACHE_FOLDER = CACHE_MOUNT;
  env.LDAP_ENABLED = values.authMode === "ldap" ? "true" : "false";
  if (values._apiKey) env.INTERNAL_API_KEY = values._apiKey;

  // Fixed rather than asked, once health checking is on: the VPN watchdog
  // schedules probes itself (see watchdog/vpnWatchdog.js), so a second
  // self-probe schedule here would just hit the provider twice for the same
  // information. HEALTHCHECK_MIN_INTERVAL_SECONDS still needs to be short —
  // not zero — so a forced probe during a heal actually gets a fresh read
  // rather than a stale cached one from before the last reconnect.
  if (values.healthCheckEnabled) {
    env.HEALTHCHECK_TIMES = "";
    env.HEALTHCHECK_MIN_INTERVAL_SECONDS = "10";
  }

  const database = connectionTarget(getComponentValues("postgres"));
  if (database.host) {
    env.DB_HOST = database.host;
    env.DB_PORT = String(database.port);
    env.DB_NAME = values._dbName || "";
    env.DB_USER = values._dbUser || "";
    env.DB_PASSWORD = values._dbPassword || "";
  }

  const spec = {
    name,
    image: values.image || "ghcr.io/x3n0n10/stream-share:latest",
    env,
    volumes: [`${configDir}:${CONFIG_MOUNT}`, `${cacheDir}:${CACHE_MOUNT}`],
    // The image runs as a non-root user and never chowns what it is given, so
    // it has to run as whoever owns the directories above — which is the Suite.
    user: ownershipString(),
    restartPolicy: "unless-stopped",
  };
```

becomes:

```js
export async function renderInstanceSpec(values, key) {
  const name = instanceContainerName(key, values);
  const port = Number(values.port);

  const configDir = ensureDirectory(componentDataDir(name), "config");
  // No shared root to fall back to any more (see store/paths.js) — an
  // instance that doesn't cache anything doesn't get a cache mount at all.
  const cachingOn = values.vodCacheEnabled === "true" || values.catchupEnabled === "true";
  const cacheDir = cachingOn ? ensureDirectory(values.cachePath) : null;

  const env = {
    ...parseExtraEnv(values.extraEnv),
    ...renderEnv(INSTANCE_SCHEMA, values),
  };

  // Computed rather than asked for — see the schema's header for why each one
  // is not a field.
  env.PORT = String(port);
  env.INSTANCE_NAME = values.displayName || key;
  if (cachingOn) env.CACHE_FOLDER = CACHE_MOUNT;
  env.LDAP_ENABLED = values.authMode === "ldap" ? "true" : "false";
  if (values._apiKey) env.INTERNAL_API_KEY = values._apiKey;
  // Discord needs the same externally-reachable address stream-share's own
  // players already use — see schema/instance.js's Discord group header for
  // why this isn't a field asked for a second time.
  if (values.discordEnabled) env.DISCORD_API_URL = values.publicBaseUrl;

  // Fixed rather than asked, once health checking is on: the VPN watchdog
  // schedules probes itself (see watchdog/vpnWatchdog.js), so a second
  // self-probe schedule here would just hit the provider twice for the same
  // information. HEALTHCHECK_MIN_INTERVAL_SECONDS still needs to be short —
  // not zero — so a forced probe during a heal actually gets a fresh read
  // rather than a stale cached one from before the last reconnect.
  if (values.healthCheckEnabled) {
    env.HEALTHCHECK_TIMES = "";
    env.HEALTHCHECK_MIN_INTERVAL_SECONDS = "10";
  }

  const database = connectionTarget(getComponentValues("postgres"));
  if (database.host) {
    env.DB_HOST = database.host;
    env.DB_PORT = String(database.port);
    env.DB_NAME = values._dbName || "";
    env.DB_USER = values._dbUser || "";
    env.DB_PASSWORD = values._dbPassword || "";
  }

  const spec = {
    name,
    image: values.image || "ghcr.io/x3n0n10/stream-share:latest",
    env,
    volumes: [
      `${configDir}:${CONFIG_MOUNT}`,
      ...(cacheDir ? [`${cacheDir}:${CACHE_MOUNT}`] : []),
    ],
    // The image runs as a non-root user and never chowns what it is given, so
    // it has to run as whoever owns the directories above — which is the Suite.
    user: ownershipString(),
    restartPolicy: "unless-stopped",
  };
```

The rest of the function (the `if (isVpnEnabled()) { ... } else { ... }` block and `return spec;`) is unchanged.

Also update the import line near the top of the file — `componentCacheDir` is no longer used here (Task 5 removes it from `store/paths.js` entirely, so this file must stop importing it now):

```js
import { componentDataDir, ensureDirectory, ownershipString } from "../store/paths.js";
```

(was `import { componentDataDir, componentCacheDir, ensureDirectory, ownershipString } from "../store/paths.js";`)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npm test`
Expected: PASS — all four new tests pass, and the full suite still passes (the pre-existing topology tests never checked for a `:/cache` volume specifically, so they're unaffected by it disappearing when caching is off).

- [ ] **Step 5: Commit**

```bash
cd server
git add src/reconcile/instance.js test/instance.test.js
git commit -m "$(cat <<'EOF'
Make the cache mount conditional; compute DISCORD_API_URL

An instance with neither VOD caching nor catchup on now gets no cache
volume at all, instead of an always-present, possibly-unused one.
DISCORD_API_URL is derived from publicBaseUrl when Discord is on.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Per-instance readiness check; remove `SUITE_CACHE_DIR`

**Files:**
- Modify: `server/src/reconcile/catalog.js` (the `instance` entry's `ready`, and the `getCachePath` import)
- Modify: `server/src/reconcile/reconciler.js:216` (pass `values` into `node.ready`)
- Modify: `server/src/store/paths.js` (remove `getCachePath`/`componentCacheDir`)
- Modify: `server/test/paths.test.js`, `server/test/caddy.test.js`, `server/test/import.test.js`, `server/test/instance.test.js` (remove now-dead `SUITE_CACHE_DIR` setup)

**Interfaces:**
- Consumes: `values.cachePath`/`vodCacheEnabled`/`catchupEnabled` (Task 3).
- Produces: `entry.ready` for the `instance` catalog kind changes from `() => string|null` to `(values) => string|null`; `store/paths.js` no longer exports `getCachePath`/`componentCacheDir`.

- [ ] **Step 1: Write the failing test**

Add to `server/test/instance.test.js`, after the `"an instance with no usable stack paths is incomplete rather than mis-mounted"` test:

```js
test("an instance caching without a usable cache path is incomplete, naming it", async () => {
  configureStack();
  const { key } = provisionInstance({ ...PROVIDER, vodCacheEnabled: "true", cachePath: "/definitely/not/mounted" });

  const { plans } = await planStack();
  const instance = plans.find((p) => p.kind === "instance");

  assert.equal(instance.action, "incomplete");
  assert.match(instance.reason, /cache path/i);
});

test("an instance not caching anything is unaffected by the cache path check", async () => {
  configureStack();
  const { key } = provisionInstance(PROVIDER);

  const { plans } = await planStack();
  const instance = plans.find((p) => p.kind === "instance");

  assert.notEqual(instance.action, "incomplete");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && npm test`
Expected: FAIL — today's `ready()` check still validates the (currently-set-by-`beforeEach`) global `SUITE_CACHE_DIR`, which is a real, writable temp dir, so the first test's instance is reported ready/incomplete for the wrong reason (or not incomplete at all) rather than because of its own bogus `cachePath`.

- [ ] **Step 3: Implement**

In `server/src/reconcile/catalog.js`, remove `getCachePath` from the import (line 29):

```js
import { getDataPath, validatePath } from "../store/paths.js";
```

Then replace the `instance` entry's `ready` (lines 103-111):

```js
    ready: () =>
      validatePath(getDataPath(), "The stack data path") ||
      validatePath(getCachePath(), "The cache path") ||
      // An external server contributes no node, so the dependency check cannot
      // catch one that was never filled in. Without this an instance plans a
      // create and then fails mid-apply against a host that does not exist.
      (postgresTarget(getComponentValues("postgres")).host
        ? null
        : "No PostgreSQL server is configured yet."),
```

with:

```js
    // Takes the instance's own resolved values (see reconciler.js's
    // planStack, which already has them at hand) rather than reading
    // anything global — the cache path is per-instance now, so "is it
    // usable" can only be answered for one instance at a time.
    ready: (values) =>
      validatePath(getDataPath(), "The stack data path") ||
      ((values.vodCacheEnabled === "true" || values.catchupEnabled === "true")
        ? validatePath(values.cachePath, "This instance's cache path")
        : null) ||
      // An external server contributes no node, so the dependency check cannot
      // catch one that was never filled in. Without this an instance plans a
      // create and then fails mid-apply against a host that does not exist.
      (postgresTarget(getComponentValues("postgres")).host
        ? null
        : "No PostgreSQL server is configured yet."),
```

In `server/src/reconcile/reconciler.js`, line 216:

```js
    const notReady = node.ready ? node.ready() : null;
```

becomes:

```js
    const notReady = node.ready ? node.ready(values) : null;
```

(`values` is already in scope two lines above — `const values = getComponentValues(node.kind, node.key);` — so this passes the same object every other per-node computation in this loop already uses. `postgres`'s own `ready: () => validatePath(getDataPath(), ...)` keeps working unchanged — an extra argument to a function that doesn't declare one is simply ignored in JavaScript.)

In `server/src/store/paths.js`, delete the `getCachePath` function (lines 55-57) and the `componentCacheDir` function (lines 136-140):

```js
export function getCachePath() {
  return String(process.env.SUITE_CACHE_DIR || "").trim();
}
```

and

```js
// Where one instance's cache lives: <cacheRoot>/<name>.
export function componentCacheDir(name) {
  const base = getCachePath();
  return base ? path.join(base, name) : "";
}
```

Also trim the file's header comment (lines 1-46): every sentence there that specifically mentions `SUITE_CACHE_DIR`/the cache path alongside `SUITE_DATA_DIR` needs to drop the cache half, since only `SUITE_DATA_DIR` remains. Replace the whole header comment block (lines 1-46) with:

```js
// Where components keep their data on the host.
//
// This is a HOST path, because it becomes a bind-mount source for containers
// the Suite creates — and a bind mount is resolved by the Docker daemon on the
// host, not inside the Suite. That means the Suite cannot create a directory
// at a host path it cannot itself see. Rather than carrying a second "and
// where is that mounted inside you" setting, the Suite requires this path to
// be mounted at the same location inside its own container:
//
//   volumes:
//     - /mnt/user/appdata/streamshare:/mnt/user/appdata/streamshare
//
// Then the path means the same thing on both sides of the boundary and there
// is nothing to translate. validatePath below is what turns getting this wrong
// into a sentence rather than a container that fails to start.
//
// This comes from SUITE_DATA_DIR — set once in compose and never touched in
// the UI; see the README's "Where component data lives" section. There is
// deliberately no UI-facing override: the only consumer of one would have
// been re-declaring the exact same string the compose file already carries,
// which is the retyping this was built to avoid, not a second real use case.
//
// An instance's own cache path is a different story — each instance's
// cachePath field is a real, per-instance, always-explicit value asked for
// directly (see schema/instance.js), not a computed path under some shared
// root the way it used to be. There's nothing to read from the environment
// for it any more.
//
// Self-inspection (the same trick that computes gluetun's
// FIREWALL_OUTBOUND_SUBNETS from the Suite's own networks) was considered and
// rejected for reading this at all: `docker inspect` would hand back every
// one of the Suite's bind mounts, but not which one is "the data path" —
// that's a question about intent, not topology, and there is no reliable way
// to tell a config mount from an unrelated one an operator happens to have
// without some deliberate signal. An env var already is that signal, and
// declaring it once in compose is exactly as much typing as a label would
// have been.
//
// Reading this correctly depends on the backing variable being a bind mount
// rather than a Docker-managed named volume: the Suite cannot tell the two
// apart by looking at it from inside — both simply appear as a writable
// directory. Someone who keeps a named volume from an earlier phase and
// upgrades without changing it will have this silently resolve to the wrong
// kind of path, so the shipped compose file uses a bind mount for exactly
// this reason.
```

And update `componentDataDir`'s own doc comment (`// Where one component's configuration lives: <base>/<name>.`) — it's already accurate and needs no change; only `componentCacheDir` (deleted above) and the file header referenced the cache path.

Finally, in `server/src/store/paths.js`, remove any now-unused import — check `path` is still used by `componentDataDir`/`validatePath`/`ensureDirectory` (it is, via `path.join`/`path.isAbsolute`), so no import changes are needed there.

- [ ] **Step 4: Clean up now-dead `SUITE_CACHE_DIR` test setup**

In `server/test/paths.test.js`:
- Remove `getCachePath` from the import line: `import { getDataPath, validatePath } from "../src/store/paths.js";`
- Remove the `originalCacheEnv` variable, its read in `beforeEach`, and its restore in `afterEach`.
- Delete the `"the cache path reads directly from SUITE_CACHE_DIR"` and `"with SUITE_CACHE_DIR unset, the cache path is empty"` tests entirely.
- Delete the `"the data and cache paths read independently of each other"` test entirely (its whole premise — two independent paths — no longer applies).
- Update the file's header comment (currently `// Reading the data and cache paths from SUITE_DATA_DIR / SUITE_CACHE_DIR, and\n// the pieces of validatePath that don't need a whole component to exercise.\n// There is deliberately no UI-facing override to test here: both paths are\n// pure reads of their environment variable, nothing more.`) to:

```js
// Reading the data path from SUITE_DATA_DIR, and the pieces of validatePath
// that don't need a whole component to exercise. There is deliberately no
// UI-facing override to test here: it's a pure read of its environment
// variable, nothing more.
```

In `server/test/caddy.test.js`: remove the `process.env.SUITE_CACHE_DIR = root;` line from `beforeEach` and the `delete process.env.SUITE_CACHE_DIR;` line from `after`.

In `server/test/import.test.js`: remove the `process.env.SUITE_CACHE_DIR = "";` line from `beforeEach`.

In `server/test/instance.test.js`:
- Remove `process.env.SUITE_CACHE_DIR = root;` from the top-level `beforeEach` (around line 80) and `delete process.env.SUITE_CACHE_DIR;` from the top-level `after` (around line 68).
- In the `"an instance with no usable stack paths is incomplete rather than mis-mounted"` test, remove its `delete process.env.SUITE_CACHE_DIR;` line, keeping `delete process.env.SUITE_DATA_DIR;`.
- Update that `beforeEach`'s comment (`// A real directory, because validatePath deliberately refuses a path the\n// Suite cannot see — the whole point of it is to fail here rather than at\n// container-start time. Both paths now come from the environment, same as\n// they would from compose's SUITE_DATA_DIR / SUITE_CACHE_DIR.`) to:

```js
  // A real directory, because validatePath deliberately refuses a path the
  // Suite cannot see — the whole point of it is to fail here rather than at
  // container-start time. Comes from the environment, same as it would from
  // compose's SUITE_DATA_DIR.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && npm test`
Expected: PASS — the two new tests from Step 1 pass, and the full suite (all files touched in this step) passes with no leftover reference to `SUITE_CACHE_DIR` or `getCachePath`/`componentCacheDir` anywhere. Confirm with:

```bash
grep -rn "SUITE_CACHE_DIR\|getCachePath\|componentCacheDir" server/src server/test
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
cd server
git add src/reconcile/catalog.js src/reconcile/reconciler.js src/store/paths.js test/paths.test.js test/caddy.test.js test/import.test.js test/instance.test.js
git commit -m "$(cat <<'EOF'
Remove SUITE_CACHE_DIR; instance readiness checks its own cache path

The instance kind's ready() now takes that instance's own resolved
values (already computed once per node in planStack) instead of
reading a global path — the last two call sites of getCachePath/
componentCacheDir, now deleted along with their tests.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Update `docker-compose.yml` and `README.md`

**Files:**
- Modify: `docker-compose.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing (docs only).
- Produces: nothing consumed by later tasks — this is purely bringing the shipped example and documentation in line with Task 5's removal.

- [ ] **Step 1: Update `docker-compose.yml`**

Remove the `SUITE_CACHE_DIR: /mnt/user/cache/stream-share-suite` line (line 33) from the `environment:` block, and remove its matching bind mount and the comment introducing it (around line 70, `# A second, separate bind mount for SUITE_CACHE_DIR above — the same` and the volume line under it).

- [ ] **Step 2: Update `README.md`**

In the configuration table (around line 50), remove the `SUITE_CACHE_DIR` row entirely:

```
| `SUITE_CACHE_DIR` | — | Default VOD/catchup cache root for every instance. See **Where component data lives** below. |
```

In the "Where component data lives" section (around lines 300-325), replace:

```
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
```

with:

```
One host path — configuration — set only in compose, never in the UI. It's
an environment variable, read once at startup, exactly like it already was
for `suite.db`:

```yaml
environment:
  SUITE_DATA_DIR: /mnt/user/appdata/stream-share-suite

volumes:
  - /mnt/user/appdata/stream-share-suite:/mnt/user/appdata/stream-share-suite
```

**Configuration** (`SUITE_DATA_DIR`) is the same folder `suite.db` already
lives in — every component gets its own subfolder there (`gluetun/`,
`provider-1/config/`, `postgres/data/`, ...).

Each instance's VOD/catchup **cache** is a different story: since it can
reach tens of gigabytes and often belongs on a different disk than a few
kilobytes of config, it's a per-instance host path entered directly for that
instance (in Setup or on the Stack page) rather than a shared, compose-time
setting — there's no `SUITE_CACHE_DIR` to configure.
```

Also check the two other lines flagged earlier (`**Use bind mounts for `SUITE_DATA_DIR` and `SUITE_CACHE_DIR`, not named` around line 63, and `long enough to fix that one directory, and nothing else. `SUITE_CACHE_DIR` gets` around line 72) and their surrounding paragraph — read that paragraph in full in the editor before changing it (it explains *why* bind mounts, not named volumes, are required) and rewrite it to talk about `SUITE_DATA_DIR` alone, preserving the same reasoning about bind mounts vs. named volumes.

- [ ] **Step 3: Verify no leftover reference**

Run: `grep -n "SUITE_CACHE_DIR" docker-compose.yml README.md`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml README.md
git commit -m "$(cat <<'EOF'
Remove SUITE_CACHE_DIR from compose and docs

Matches the backend removal: cache location is now a per-instance
value entered directly, not a shared compose-time setting.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Extract `describeFailures` to `web/src/lib/applyToAll.js`

**Files:**
- Create: `web/src/lib/applyToAll.js`
- Modify: `web/src/pages/Aliases.jsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `describeFailures(targets, results)` — `targets` an array of objects each with a `name` property, `results` the array a `Promise.allSettled` returns (same length, same order as `targets`); returns `null` if every result fulfilled, otherwise a string naming each rejected target and its reason. This is the exact function `Aliases.jsx` already has; later wizard tasks (10, 12, 14) import it too.

- [ ] **Step 1: Create the helper**

`web/src/pages/Aliases.jsx` currently defines (inside the `Aliases` component, so it closes over nothing external — safe to lift verbatim):

```js
  function describeFailures(targets, results) {
    const failed = results
      .map((r, idx) => ({ r, instance: targets[idx] }))
      .filter(({ r }) => r.status === "rejected");
    if (failed.length === 0) return null;
    return `Failed on ${failed.map(({ instance, r }) => `${instance.name} (${r.reason.message})`).join(", ")}`;
  }
```

Create `web/src/lib/applyToAll.js`:

```js
// Shared by every wizard/page step that applies one action to several
// instances at once via Promise.allSettled: names which ones failed and why,
// rather than failing the whole step over one bad instance.
export function describeFailures(targets, results) {
  const failed = results
    .map((r, idx) => ({ r, instance: targets[idx] }))
    .filter(({ r }) => r.status === "rejected");
  if (failed.length === 0) return null;
  return `Failed on ${failed.map(({ instance, r }) => `${instance.name} (${r.reason.message})`).join(", ")}`;
}
```

- [ ] **Step 2: Use it from `Aliases.jsx`**

Add the import near the top of `web/src/pages/Aliases.jsx` (alongside the other `lib` imports):

```js
import { describeFailures } from "../lib/applyToAll.js";
```

Delete the local `describeFailures` function definition (the one shown in Step 1) from inside the `Aliases` component — every call site (`submitAlias`, `removeGroup`) keeps calling `describeFailures(...)` exactly as before, now resolving to the imported one.

- [ ] **Step 3: Verify the build**

Run: `cd web && npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 4: Manual check**

Start the dev server (`cd web && npm run dev`, or use whatever the project's `run` skill/dev workflow is) and, on the Aliases page, add an alias applied to all instances, then remove one — confirm the same partial-failure messaging as before still appears if you simulate a failure (e.g. stop one instance's container) — behavior must be identical to before this extraction, since the function's code didn't change, only its location.

- [ ] **Step 5: Commit**

```bash
cd web
git add src/lib/applyToAll.js src/pages/Aliases.jsx
git commit -m "$(cat <<'EOF'
Extract describeFailures into lib/applyToAll.js

Prep for the setup wizard's multi-instance steps (caching, external
access, health check), which need the same "report partial failures by
name" pattern Aliases.jsx already has.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `SchemaForm`'s client-side `dependsOn` gets the same `any` support

**Files:**
- Modify: `web/src/components/SchemaForm.jsx:19-26` (the `isVisible` function)

**Interfaces:**
- Consumes: nothing new.
- Produces: `SchemaForm`'s internal `isVisible` now understands `{ any: [...] }` the same way `registry.js`'s server-side version does (Task 1) — needed so Stack's existing generic edit form correctly shows/hides `cachePath` for an existing instance. This mirrors the server's logic the same way this file already mirrors it for `oneOf`/`equals` (there is no shared module between client and server schema code in this codebase — see `web/src/lib/containerName.js`'s header comment for the same "mirrors, not a second source of truth" convention already accepted here).

- [ ] **Step 1: Manual verification plan (no test framework in `web/`)**

Since cachePath doesn't reach Stack's generic form until Task 3's backend fields exist (already merged by now) — after this change, on the Stack page, editing an instance with neither `vodCacheEnabled` nor `catchupEnabled` on should NOT show a "Cache location on the host" field; turning either one on (and saving, then re-opening edit, or toggling live if the form re-renders on change — check `SchemaForm`'s `draft` state updates trigger a re-render, which they do via `setDraft`) should make it appear. This is the manual check to run after Step 2 below.

- [ ] **Step 2: Implement**

In `web/src/components/SchemaForm.jsx`, replace the existing `isVisible` function:

```js
  function isVisible(field) {
    if (!field.dependsOn) return true;
    const conditions = Array.isArray(field.dependsOn) ? field.dependsOn : [field.dependsOn];
    return conditions.every((condition) => {
      const depValue = draft[condition.key];
      return "oneOf" in condition ? condition.oneOf.includes(depValue) : depValue === condition.equals;
    });
  }
```

with:

```js
  // Mirrors registry.js's conditionMet/isVisible on the server — see that
  // file for why a condition can also be { any: [...] }. No shared module
  // between client and server here, same as containerName.js's preview logic
  // already isn't; this is a preview of the same rule, not a second source
  // of truth the server would ever defer to.
  function conditionMet(condition) {
    if ("any" in condition) return condition.any.some(conditionMet);
    const depValue = draft[condition.key];
    return "oneOf" in condition ? condition.oneOf.includes(depValue) : depValue === condition.equals;
  }

  function isVisible(field) {
    if (!field.dependsOn) return true;
    const conditions = Array.isArray(field.dependsOn) ? field.dependsOn : [field.dependsOn];
    return conditions.every(conditionMet);
  }
```

- [ ] **Step 3: Verify the build**

Run: `cd web && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manual check**

Follow the plan from Step 1 against a running dev server and a real (or freshly created) instance on the Stack page.

- [ ] **Step 5: Commit**

```bash
cd web
git add src/components/SchemaForm.jsx
git commit -m "$(cat <<'EOF'
Mirror the schema engine's any (OR) condition support client-side

SchemaForm's own dependsOn evaluator needs to understand { any: [...] }
too, so Stack's generic edit form correctly shows/hides an instance's
cachePath field (required via an any of two caching flags).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `Setup.jsx` orchestrator shell + `StepDone.jsx`

**Files:**
- Create: `web/src/pages/setup/StepDone.jsx`
- Modify: `web/src/pages/Setup.jsx` (full rewrite)

**Interfaces:**
- Produces: `Setup.jsx` default-exports a component with no props (matches its current route usage), managing `step` (a string id, not an index — the sequence isn't a fixed-length array since Step 6 is conditionally skipped) and `instances` (array of `{ key, port, displayName }`) in state, passed down to each step component as props: `onNext(patch)`, `onBack()`, `instances`, `setInstances`. Every later task (10-14) is a step component consumed by this orchestrator; `STEP_ORDER` here is the single source of truth for sequencing.
- `StepDone` — props: `{ createdAnyInstance, navigate }`. No API calls; mirrors today's final step exactly.

- [ ] **Step 1: Write `StepDone.jsx`**

This is a direct lift of today's `Setup.jsx` step-4 JSX (the "You're set up" card), with `createdAnyInstance` replacing today's `createdInstance` boolean (renamed since Step 1 in the new flow always creates at least one instance — the prop name just needs to stay accurate to what's actually being reported, which is now always `true` in practice, but kept as a prop rather than hardcoded so the component doesn't assume its caller's invariants):

```jsx
import { Card, Button } from "../../components/common.jsx";

export default function StepDone({ navigate }) {
  return (
    <Card className="p-6 text-center">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">You're set up</h2>
      <p className="mx-auto mt-2 max-w-prose text-sm text-slate-500 dark:text-slate-400">
        Nothing has actually been created on Docker yet: review the plan and apply it to bring the
        containers up.
      </p>
      <div className="mt-5 flex justify-center gap-2">
        <Button tone="accent" onClick={() => navigate("/stack")}>
          Review the stack plan
        </Button>
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Rewrite `Setup.jsx`**

Replace the entire contents of `web/src/pages/Setup.jsx` with:

```jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import StepInstances from "./setup/StepInstances.jsx";
import StepCaching from "./setup/StepCaching.jsx";
import StepDatabase from "./setup/StepDatabase.jsx";
import StepExternalAccess from "./setup/StepExternalAccess.jsx";
import StepVpn from "./setup/StepVpn.jsx";
import StepHealthCheck from "./setup/StepHealthCheck.jsx";
import StepDone from "./setup/StepDone.jsx";

// Each step decides for itself where "next" goes (StepVpn skips
// StepHealthCheck when the VPN is off), so this is a lookup by id rather
// than a fixed-index array — see each step's own onNext call for the
// sequencing decision that actually matters.
const STEP_LABELS = {
  instances: "Instances",
  caching: "Caching",
  database: "Database",
  access: "External access",
  vpn: "VPN",
  health: "Health check",
  done: "Done",
};

function Progress({ step }) {
  const order = Object.keys(STEP_LABELS);
  const current = order.indexOf(step);

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 px-1">
      {order.map((id, i) => (
        <div key={id} className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
              i === current
                ? "bg-accent-600 text-white"
                : i < current
                  ? "bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-400"
                  : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
            }`}
          >
            {i + 1}
          </span>
          <span
            className={`hidden text-xs sm:inline ${
              i === current ? "font-medium text-slate-900 dark:text-white" : "text-slate-400 dark:text-slate-500"
            }`}
          >
            {STEP_LABELS[id]}
          </span>
          {i < order.length - 1 && <span className="mx-1 h-px w-6 bg-slate-200 dark:bg-slate-800" />}
        </div>
      ))}
    </div>
  );
}

export default function Setup() {
  const navigate = useNavigate();
  const [step, setStep] = useState("instances");
  // { key, port, displayName } per instance created this run — later steps
  // (caching, access, health) both read and patch entries here.
  const [instances, setInstances] = useState([]);

  const stepProps = { instances, setInstances, onNext: setStep, onBack: setStep };

  return (
    <Layout title="Setup wizard">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Progress step={step} />

        {step === "instances" && <StepInstances {...stepProps} />}
        {step === "caching" && <StepCaching {...stepProps} />}
        {step === "database" && <StepDatabase {...stepProps} />}
        {step === "access" && <StepExternalAccess {...stepProps} />}
        {step === "vpn" && <StepVpn {...stepProps} />}
        {step === "health" && <StepHealthCheck {...stepProps} />}
        {step === "done" && <StepDone navigate={navigate} />}
      </div>
    </Layout>
  );
}
```

(`onNext`/`onBack` are both just `setStep` — a step component calls `onNext("caching")` or `onBack("instances")` with the literal id it wants to move to, since the "what comes next" decision differs per step, e.g. `StepVpn` calling `onNext("health")` or `onNext("done")` depending on whether VPN is on.)

- [ ] **Step 3: Verify the build**

Run: `cd web && npm run build`
Expected: FAILS at this point — `StepInstances.jsx`, `StepCaching.jsx`, `StepDatabase.jsx`, `StepExternalAccess.jsx`, `StepVpn.jsx`, `StepHealthCheck.jsx` don't exist yet (Tasks 10-14 create them). This is expected and correct — do not treat it as a problem to fix in this task; the next five tasks each create one missing file. If you want an intermediate green build, temporarily comment out the five missing imports and their JSX lines, confirm the build passes with just `StepDone`, then restore them before starting Task 10 (leaving them commented is fine to carry between tasks if executing this plan across multiple sessions).

- [ ] **Step 4: Commit**

```bash
cd web
git add src/pages/Setup.jsx src/pages/setup/StepDone.jsx
git commit -m "$(cat <<'EOF'
Rebuild Setup.jsx as a slim orchestrator over per-step files

Tracks the current step (by id, not index — VPN conditionally skips
the health-check step) and the instances created this run. Step
components land in the next five tasks; this alone will not build
until they exist.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `StepInstances.jsx`

**Files:**
- Create: `web/src/pages/setup/StepInstances.jsx`

**Interfaces:**
- Consumes: `api.createStackInstance`, `api.componentFields("instance")`, `SchemaForm`, `Card`/`Button`/`ErrorNote` from `common.jsx`.
- Produces: on completion, calls `props.setInstances((prev) => [...prev, { key, port, displayName }])` once per created instance, then `props.onNext("caching")`. Props: `{ instances, setInstances, onNext }` (matches Task 9's `stepProps`; `onBack` unused here since this is the first step).

- [ ] **Step 1: Write the component**

```jsx
import { useState } from "react";
import { Card, Button, ErrorNote } from "../../components/common.jsx";
import { api } from "../../lib/api.js";

const ACCESS_MODES = [
  { value: "provider", label: "Use my provider credentials" },
  { value: "custom", label: "Set custom credentials" },
  { value: "ldap", label: "Use LDAP" },
];

const FIELD =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
  "placeholder:text-slate-400 focus:border-accent-500 focus:outline-none focus:ring-1 " +
  "focus:ring-accent-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white";

function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-slate-400 dark:text-slate-500">{hint}</span>}
    </label>
  );
}

function blankDraft() {
  return {
    displayName: "",
    xtreamBaseUrl: "",
    xtreamUser: "",
    xtreamPassword: "",
    accessMode: "provider",
    authUser: "",
    authPassword: "",
    ldapServer: "",
    ldapBaseDn: "",
    ldapBindDn: "",
    ldapBindPassword: "",
  };
}

// The 3-way choice ("use my provider creds" / custom / LDAP) isn't a real
// authMode value — only "basic" and "ldap" are. Picking "provider" here just
// means: submit authMode "basic" with the same username/password already
// typed into the Provider fields above, instead of asking for them again.
function toPatch(draft) {
  const base = {
    displayName: draft.displayName,
    xtreamBaseUrl: draft.xtreamBaseUrl,
    xtreamUser: draft.xtreamUser,
    xtreamPassword: draft.xtreamPassword,
  };

  if (draft.accessMode === "ldap") {
    return {
      ...base,
      authMode: "ldap",
      ldapServer: draft.ldapServer,
      ldapBaseDn: draft.ldapBaseDn,
      ldapBindDn: draft.ldapBindDn,
      ldapBindPassword: draft.ldapBindPassword,
    };
  }

  if (draft.accessMode === "custom") {
    return { ...base, authMode: "basic", authUser: draft.authUser, authPassword: draft.authPassword };
  }

  // "provider"
  return { ...base, authMode: "basic", authUser: draft.xtreamUser, authPassword: draft.xtreamPassword };
}

export default function StepInstances({ instances, setInstances, onNext }) {
  const [draft, setDraft] = useState(blankDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function set(key, value) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function addInstance(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { key, port } = await api.createStackInstance(toPatch(draft));
      setInstances((prev) => [...prev, { key, port, displayName: draft.displayName }]);
      setDraft(blankDraft());
    } catch (err) {
      setError(err.body?.errors?.map((e) => e.message).join(" ") || err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">Your instances</h2>
      <p className="mt-1.5 max-w-prose text-sm text-slate-500 dark:text-slate-400">
        One StreamShare instance per IPTV provider. At least one is required — add as many as you
        need, one at a time.
      </p>

      {instances.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1.5">
          {instances.map((i) => (
            <li
              key={i.key}
              className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60"
            >
              <span className="font-medium text-slate-800 dark:text-slate-100">{i.displayName}</span>
              <span className="text-xs text-slate-400">port {i.port}</span>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={addInstance} className="mt-5 flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <input
              className={FIELD}
              value={draft.displayName}
              onChange={(e) => set("displayName", e.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label="Xtream base URL" hint="e.g. http://provider.example:8080">
            <input
              className={FIELD}
              value={draft.xtreamBaseUrl}
              onChange={(e) => set("xtreamBaseUrl", e.target.value)}
              required
            />
          </Field>
          <Field label="Xtream username">
            <input
              className={FIELD}
              value={draft.xtreamUser}
              onChange={(e) => set("xtreamUser", e.target.value)}
              required
            />
          </Field>
          <Field label="Xtream password">
            <input
              className={FIELD}
              type="password"
              value={draft.xtreamPassword}
              onChange={(e) => set("xtreamPassword", e.target.value)}
              required
            />
          </Field>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">How users sign in</span>
          <div className="flex flex-wrap gap-2">
            {ACCESS_MODES.map((mode) => (
              <button
                key={mode.value}
                type="button"
                onClick={() => set("accessMode", mode.value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  draft.accessMode === mode.value
                    ? "bg-accent-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>

        {draft.accessMode === "custom" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Username">
              <input
                className={FIELD}
                value={draft.authUser}
                onChange={(e) => set("authUser", e.target.value)}
                required
              />
            </Field>
            <Field label="Password">
              <input
                className={FIELD}
                type="password"
                value={draft.authPassword}
                onChange={(e) => set("authPassword", e.target.value)}
                required
              />
            </Field>
          </div>
        )}

        {draft.accessMode === "ldap" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="LDAP server" hint="e.g. ldap://ldap.example:389">
              <input
                className={FIELD}
                value={draft.ldapServer}
                onChange={(e) => set("ldapServer", e.target.value)}
                required
              />
            </Field>
            <Field label="Base DN">
              <input
                className={FIELD}
                value={draft.ldapBaseDn}
                onChange={(e) => set("ldapBaseDn", e.target.value)}
                required
              />
            </Field>
            <Field label="Bind DN">
              <input
                className={FIELD}
                value={draft.ldapBindDn}
                onChange={(e) => set("ldapBindDn", e.target.value)}
                required
              />
            </Field>
            <Field label="Bind password">
              <input
                className={FIELD}
                type="password"
                value={draft.ldapBindPassword}
                onChange={(e) => set("ldapBindPassword", e.target.value)}
                required
              />
            </Field>
          </div>
        )}

        {error && <ErrorNote message={error} />}

        <div className="flex items-center gap-2">
          <Button type="submit" tone="accent" loading={saving} disabled={saving}>
            Add instance
          </Button>
          {instances.length > 0 && (
            <Button type="button" tone="ghost" onClick={() => onNext("caching")}>
              Continue with {instances.length} instance{instances.length === 1 ? "" : "s"}
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}
```

- [ ] **Step 2: Verify the build**

Run: `cd web && npm run build`
Expected: still fails on the four remaining missing step files (`StepCaching`, `StepDatabase`, `StepExternalAccess`, `StepVpn`, `StepHealthCheck`) unless you commented those imports out in Task 9 — if you did, uncomment `StepInstances`'s import/usage in `Setup.jsx` now and confirm the build's only remaining errors are about the still-missing files.

- [ ] **Step 3: Manual check**

Run the dev server, sign in, navigate to `/setup`. Add an instance with each of the three access modes in turn and confirm each POST succeeds (watch the network tab or server log) and the running list updates. Confirm "Continue" only appears once at least one instance exists.

- [ ] **Step 4: Commit**

```bash
cd web
git add src/pages/setup/StepInstances.jsx
git commit -m "$(cat <<'EOF'
Add StepInstances: the wizard's add-another instance loop

Provider fields plus a hand-built 3-way access chooser (provider
creds / custom / LDAP) layered over the real 2-value authMode field.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `StepCaching.jsx`

**Files:**
- Create: `web/src/pages/setup/StepCaching.jsx`

**Interfaces:**
- Consumes: `api.updateStackInstance`, `describeFailures` (Task 7).
- Produces: on continue, patches every instance in `props.instances` with `{ vodCacheEnabled, catchupEnabled, catchupDurationHours, cachePath }` (the last only per-instance), then `props.onNext("database")`.

- [ ] **Step 1: Write the component**

```jsx
import { useState } from "react";
import { Card, Button, ErrorNote } from "../../components/common.jsx";
import { api } from "../../lib/api.js";
import { describeFailures } from "../../lib/applyToAll.js";

const FIELD =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
  "placeholder:text-slate-400 focus:border-accent-500 focus:outline-none focus:ring-1 " +
  "focus:ring-accent-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white";

export default function StepCaching({ instances, onNext }) {
  const [vodCacheEnabled, setVodCacheEnabled] = useState(false);
  const [catchupEnabled, setCatchupEnabled] = useState(false);
  const [catchupDurationHours, setCatchupDurationHours] = useState("4");
  const [parentPath, setParentPath] = useState("");
  // key -> suggested/edited full path, seeded from parentPath once it's typed.
  const [cachePaths, setCachePaths] = useState({});
  // key -> the last value we auto-suggested for it, so a later parent-path
  // edit knows whether to re-suggest (untouched) or leave it alone (the user
  // already typed something different).
  const [suggestedFor, setSuggestedFor] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const cachingOn = vodCacheEnabled || catchupEnabled;

  function updateParentPath(value) {
    setParentPath(value);
    const trimmedRoot = value.replace(/\/+$/, "");
    const suggestions = Object.fromEntries(
      instances.map((i) => [i.key, value ? `${trimmedRoot}/${i.key}` : ""])
    );

    setCachePaths((prev) => {
      const next = { ...prev };
      for (const instance of instances) {
        // Only overwrite a path the user hasn't hand-edited away from the
        // previous suggestion for this same parent.
        if (!prev[instance.key] || prev[instance.key] === suggestedFor[instance.key]) {
          next[instance.key] = suggestions[instance.key];
        }
      }
      return next;
    });
    setSuggestedFor(suggestions);
  }

  const allPathsFilled = !cachingOn || instances.every((i) => (cachePaths[i.key] || "").trim());

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const patch = {
        vodCacheEnabled: vodCacheEnabled ? "true" : "false",
        catchupEnabled: catchupEnabled ? "true" : "false",
        ...(catchupEnabled ? { catchupDurationHours } : {}),
      };
      const results = await Promise.allSettled(
        instances.map((i) =>
          api.updateStackInstance(i.key, { ...patch, ...(cachingOn ? { cachePath: cachePaths[i.key] } : {}) })
        )
      );
      const failureMessage = describeFailures(
        instances.map((i) => ({ name: i.displayName })),
        results
      );
      if (failureMessage) {
        setError(failureMessage);
        return;
      }
      onNext("database");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">Caching</h2>
      <p className="mt-1.5 max-w-prose text-sm text-slate-500 dark:text-slate-400">
        Applies the same choice to every instance you just added — change any of it per instance
        later from the Stack page.
      </p>

      <div className="mt-5 flex flex-col gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={vodCacheEnabled}
            onChange={(e) => setVodCacheEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
          />
          Cache VOD locally
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={catchupEnabled}
            onChange={(e) => setCatchupEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
          />
          Buffer live channels for catchup
        </label>
        {catchupEnabled && (
          <label className="ml-6 flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Hours of catchup to keep
            </span>
            <input
              type="number"
              min="1"
              className={`${FIELD} w-32`}
              value={catchupDurationHours}
              onChange={(e) => setCatchupDurationHours(e.target.value)}
            />
          </label>
        )}
      </div>

      {cachingOn && (
        <div className="mt-5 border-t border-slate-200 pt-5 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Where should this stuff live?</h3>
          <label className="mt-3 flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Parent folder on the Docker host
            </span>
            <input
              className={FIELD}
              value={parentPath}
              onChange={(e) => updateParentPath(e.target.value)}
              placeholder="/mnt/user/cache/stream-share-suite"
            />
          </label>

          {parentPath && (
            <div className="mt-3 flex flex-col gap-2">
              {instances.map((instance) => (
                <label key={instance.key} className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    {instance.displayName}
                  </span>
                  <input
                    className={FIELD}
                    value={cachePaths[instance.key] || ""}
                    onChange={(e) => setCachePaths((prev) => ({ ...prev, [instance.key]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mt-4">
          <ErrorNote message={error} />
        </div>
      )}

      <div className="mt-5">
        <Button
          tone="accent"
          onClick={submit}
          loading={saving}
          disabled={saving || !allPathsFilled || (cachingOn && !parentPath)}
        >
          Continue
        </Button>
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Verify the build**

Run: `cd web && npm run build`
Expected: no new errors introduced by this file (other missing steps may still block a full pass — see Task 9's note).

- [ ] **Step 3: Manual check**

With at least two instances created in Step 1, turn on VOD caching, type a parent path, confirm each instance shows a suggested `<parent>/<key>` path, edit one, and confirm "Continue" is disabled until every instance has a non-empty path. Submit and confirm (via network tab) each instance received its own `cachePath` plus the shared `vodCacheEnabled`.

- [ ] **Step 4: Commit**

```bash
cd web
git add src/pages/setup/StepCaching.jsx
git commit -m "$(cat <<'EOF'
Add StepCaching: shared toggles, per-instance suggested cache paths

One parent folder typed once suggests <parent>/<instance.key> per
instance as an editable (not placeholder) value; every instance's
cachePath is submitted explicitly, never silently defaulted.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: `StepDatabase.jsx`

**Files:**
- Create: `web/src/pages/setup/StepDatabase.jsx`

**Interfaces:**
- Consumes: `api.componentFields("postgres")`, `api.saveComponent("postgres", patch)`, `SchemaForm`.
- Produces: on save, `props.onNext("access")`.

- [ ] **Step 1: Write the component**

This is today's `Setup.jsx` step-2 JSX, extracted as-is (same `SchemaForm` usage, same API calls), just renamed and moved:

```jsx
import { useEffect, useState } from "react";
import { Card, ErrorNote } from "../../components/common.jsx";
import SchemaForm from "../../components/SchemaForm.jsx";
import { api } from "../../lib/api.js";

export default function StepDatabase({ onNext }) {
  const [fields, setFields] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.componentFields("postgres").then((r) => setFields(r.fields));
  }, []);

  async function save(patch) {
    setSaving(true);
    setError(null);
    try {
      await api.saveComponent("postgres", patch);
      onNext("access");
    } catch (err) {
      setError(err.body?.errors?.map((e) => e.message).join(" ") || err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">PostgreSQL</h2>
      <p className="mt-1.5 max-w-prose text-sm text-slate-500 dark:text-slate-400">
        Where every instance keeps its history, VOD index and aliases. Each instance gets its own
        database, created automatically.
      </p>
      <div className="mt-5">
        {fields === null ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <SchemaForm fields={fields} onSave={save} saving={saving} error={error} submitLabel="Save and continue" />
        )}
      </div>
    </Card>
  );
}
```

(No "back" link — unlike today's wizard, going back a step here would mean unwinding already-created instances, which the spec doesn't call for; a user who wants to change something earlier can always finish the wizard and edit via Stack, same as any other post-setup change.)

- [ ] **Step 2: Verify the build**

Run: `cd web && npm run build`

- [ ] **Step 3: Manual check**

On this step, fill in an external Postgres target (or leave "managed" selected) and confirm "Save and continue" advances to the external-access step.

- [ ] **Step 4: Commit**

```bash
cd web
git add src/pages/setup/StepDatabase.jsx
git commit -m "$(cat <<'EOF'
Add StepDatabase: unchanged Postgres SchemaForm, resequenced

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: `StepExternalAccess.jsx`

**Files:**
- Create: `web/src/pages/setup/StepExternalAccess.jsx`

**Interfaces:**
- Consumes: `api.updateStackInstance`, `api.saveStackSettings`, `api.componentFields("caddy")`, `api.saveComponent("caddy", patch)`, `describeFailures` (Task 7).
- Produces: Part A patches each instance's `publicBaseUrl`/`discordEnabled`/`discordBotToken`/`discordAdminRoleId`; Part B optionally turns on Caddy. Calls `props.onNext("vpn")` when done.

- [ ] **Step 1: Write the component**

```jsx
import { useEffect, useState } from "react";
import { Card, Button, ErrorNote } from "../../components/common.jsx";
import SchemaForm from "../../components/SchemaForm.jsx";
import { api } from "../../lib/api.js";
import { describeFailures } from "../../lib/applyToAll.js";

const FIELD =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
  "placeholder:text-slate-400 focus:border-accent-500 focus:outline-none focus:ring-1 " +
  "focus:ring-accent-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white";

function blankAccess() {
  return { publicBaseUrl: "", discordEnabled: false, discordBotToken: "", discordAdminRoleId: "" };
}

export default function StepExternalAccess({ instances, onNext }) {
  const [byKey, setByKey] = useState(() => Object.fromEntries(instances.map((i) => [i.key, blankAccess()])));
  const [savingPartA, setSavingPartA] = useState(false);
  const [errorA, setErrorA] = useState(null);

  const [wantsCaddy, setWantsCaddy] = useState(null); // null: not yet asked
  const [caddyFields, setCaddyFields] = useState(null);
  const [savingCaddy, setSavingCaddy] = useState(false);
  const [errorB, setErrorB] = useState(null);

  useEffect(() => {
    if (wantsCaddy && !caddyFields) api.componentFields("caddy").then((r) => setCaddyFields(r.fields));
  }, [wantsCaddy, caddyFields]);

  function patch(key, fields) {
    setByKey((prev) => ({ ...prev, [key]: { ...prev[key], ...fields } }));
  }

  async function saveAccessAndContinue() {
    setSavingPartA(true);
    setErrorA(null);
    try {
      const results = await Promise.allSettled(
        instances.map((i) => {
          const values = byKey[i.key];
          const p = { publicBaseUrl: values.publicBaseUrl };
          if (values.discordEnabled) {
            p.discordEnabled = true;
            p.discordBotToken = values.discordBotToken;
            if (values.discordAdminRoleId) p.discordAdminRoleId = values.discordAdminRoleId;
          }
          return api.updateStackInstance(i.key, p);
        })
      );
      const failureMessage = describeFailures(
        instances.map((i) => ({ name: i.displayName })),
        results
      );
      if (failureMessage) {
        setErrorA(failureMessage);
        return;
      }
      setWantsCaddy(false); // move to Part B's question, default "no" until chosen
    } finally {
      setSavingPartA(false);
    }
  }

  async function chooseCaddy(enabled) {
    setErrorB(null);
    setWantsCaddy(enabled);
    if (!enabled) {
      onNext("vpn");
      return;
    }
    try {
      await api.saveStackSettings({ caddyEnabled: true });
    } catch (err) {
      setErrorB(err.message);
    }
  }

  async function saveCaddyAndContinue(caddyPatch) {
    setSavingCaddy(true);
    setErrorB(null);
    try {
      await api.saveComponent("caddy", caddyPatch);
      onNext("vpn");
    } catch (err) {
      setErrorB(err.body?.errors?.map((e) => e.message).join(" ") || err.message);
    } finally {
      setSavingCaddy(false);
    }
  }

  // Part A: per-instance public URL + Discord, always shown first.
  if (wantsCaddy === null) {
    return (
      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">External access</h2>
        <p className="mt-1.5 max-w-prose text-sm text-slate-500 dark:text-slate-400">
          Optional, per instance. You're responsible for the DNS/routing that actually gets traffic
          to this host — this just tells each instance what its own externally-reachable address is.
        </p>

        <div className="mt-5 flex flex-col gap-6">
          {instances.map((instance) => {
            const values = byKey[instance.key];
            return (
              <div key={instance.key} className="border-t border-slate-200 pt-4 first:border-t-0 first:pt-0 dark:border-slate-800">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{instance.displayName}</h3>
                <label className="mt-3 flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Public base URL</span>
                  <input
                    className={FIELD}
                    value={values.publicBaseUrl}
                    onChange={(e) => patch(instance.key, { publicBaseUrl: e.target.value })}
                    placeholder="https://tv.example.com/provider-1"
                  />
                </label>

                <label className="mt-3 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={values.discordEnabled}
                    disabled={!values.publicBaseUrl.trim()}
                    onChange={(e) => patch(instance.key, { discordEnabled: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500 disabled:opacity-50"
                  />
                  Enable Discord bot
                  {!values.publicBaseUrl.trim() && (
                    <span className="text-xs text-slate-400">(needs a public base URL first)</span>
                  )}
                </label>

                {values.discordEnabled && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Bot token</span>
                      <input
                        className={FIELD}
                        type="password"
                        value={values.discordBotToken}
                        onChange={(e) => patch(instance.key, { discordBotToken: e.target.value })}
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                        Admin role ID (optional)
                      </span>
                      <input
                        className={FIELD}
                        value={values.discordAdminRoleId}
                        onChange={(e) => patch(instance.key, { discordAdminRoleId: e.target.value })}
                      />
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {errorA && (
          <div className="mt-4">
            <ErrorNote message={errorA} />
          </div>
        )}

        <div className="mt-5">
          <Button tone="accent" onClick={saveAccessAndContinue} loading={savingPartA} disabled={savingPartA}>
            Continue
          </Button>
        </div>
      </Card>
    );
  }

  // Part B: the Caddy question, once, after Part A is saved.
  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">
        Also reach it from your local network?
      </h2>
      <p className="mt-1.5 max-w-prose text-sm text-slate-500 dark:text-slate-400">
        This is what Caddy is for, and only for this — it's independent of Discord and of whether
        you set a public URL above. You're still responsible for pointing that URL's DNS at this
        host; Caddy then routes it to the right instance and port once it arrives here.
      </p>

      {!wantsCaddy ? (
        <div className="mt-5 flex gap-2">
          <Button tone="accent" onClick={() => chooseCaddy(true)}>
            Yes, set up Caddy
          </Button>
          <Button tone="ghost" onClick={() => chooseCaddy(false)}>
            No, skip it
          </Button>
        </div>
      ) : caddyFields === null ? (
        <p className="mt-5 text-sm text-slate-400">Loading…</p>
      ) : (
        <div className="mt-5">
          <SchemaForm
            fields={caddyFields.filter((f) => f.group === "HTTPS")}
            onSave={saveCaddyAndContinue}
            saving={savingCaddy}
            error={errorB}
            submitLabel="Save and continue"
          />
        </div>
      )}

      {errorB && !caddyFields && (
        <div className="mt-4">
          <ErrorNote message={errorB} />
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Verify the build**

Run: `cd web && npm run build`

- [ ] **Step 3: Manual check**

With instances from Step 1: leave the first instance's Public base URL blank and confirm its Discord checkbox stays disabled; fill in a URL and confirm the checkbox becomes usable, then enable Discord and confirm the bot-token field appears and is required to continue meaningfully (note `SchemaForm`'s own validation doesn't apply here since Part A is hand-built — this component doesn't currently block "Continue" on an incomplete Discord form; if manual testing shows this is confusing, that's fine to note as a follow-up, not a blocker for this task, since the spec didn't call out inline validation here). After Part A, choose "No" for Caddy and confirm it goes straight to the VPN step; repeat choosing "Yes" and confirm the Caddy HTTPS-only form appears and advances on save.

- [ ] **Step 4: Commit**

```bash
cd web
git add src/pages/setup/StepExternalAccess.jsx
git commit -m "$(cat <<'EOF'
Add StepExternalAccess: per-instance public URL/Discord, then Caddy

Discord stays disabled per instance until that instance has a public
base URL (DISCORD_API_URL is derived from it). Caddy is a separate,
independent question asked once afterward.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: `StepVpn.jsx`

**Files:**
- Create: `web/src/pages/setup/StepVpn.jsx`

**Interfaces:**
- Consumes: `api.saveStackSettings`, `api.componentFields("gluetun")`, `api.saveComponent("gluetun", patch)`.
- Produces: `props.onNext("health")` if VPN is turned on, `props.onNext("done")` if not.

- [ ] **Step 1: Write the component**

This mirrors today's `Setup.jsx` step-0/step-1 pair (the VPN yes/no choice plus the gluetun form), just relocated and pointed at the new next-step ids:

```jsx
import { useEffect, useState } from "react";
import { Card, Button, ErrorNote } from "../../components/common.jsx";
import SchemaForm from "../../components/SchemaForm.jsx";
import { api } from "../../lib/api.js";

export default function StepVpn({ onNext }) {
  const [choice, setChoice] = useState(null); // null | true | false
  const [fields, setFields] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (choice && !fields) api.componentFields("gluetun").then((r) => setFields(r.fields));
  }, [choice, fields]);

  async function chooseVpn(enabled) {
    setError(null);
    setChoice(enabled);
    try {
      await api.saveStackSettings({ vpnEnabled: enabled });
      if (!enabled) onNext("done");
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveGluetun(patch) {
    setSaving(true);
    setError(null);
    try {
      await api.saveComponent("gluetun", patch);
      onNext("health");
    } catch (err) {
      setError(err.body?.errors?.map((e) => e.message).join(" ") || err.message);
    } finally {
      setSaving(false);
    }
  }

  if (choice === null) {
    return (
      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Route traffic through a VPN?</h2>
        <p className="mt-1.5 max-w-prose text-sm text-slate-500 dark:text-slate-400">
          Recommended if your provider restricts access by location or IP. Every instance shares one
          tunnel — this isn't per-instance. You can change this later under Stack.
        </p>
        {error && (
          <div className="mt-3">
            <ErrorNote message={error} />
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <Button tone="accent" onClick={() => chooseVpn(true)}>
            Yes, use a VPN
          </Button>
          <Button tone="ghost" onClick={() => chooseVpn(false)}>
            No, skip it
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">Gluetun (VPN)</h2>
      <p className="mt-1.5 max-w-prose text-sm text-slate-500 dark:text-slate-400">
        The tunnel every instance's traffic will route through. This container also publishes every
        instance's port, so it's configured now.
      </p>
      <div className="mt-5">
        {fields === null ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <SchemaForm fields={fields} onSave={saveGluetun} saving={saving} error={error} submitLabel="Save and continue" />
        )}
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Verify the build**

Run: `cd web && npm run build`

- [ ] **Step 3: Manual check**

Choose "No" and confirm it goes straight to `StepDone` (skipping health check). Repeat, choosing "Yes", fill in the gluetun form, save, and confirm it advances to the health-check step.

- [ ] **Step 4: Commit**

```bash
cd web
git add src/pages/setup/StepVpn.jsx
git commit -m "$(cat <<'EOF'
Add StepVpn: unchanged VPN yes/no + gluetun form, resequenced

Skips straight to done when VPN is off, since health check only
means anything with the tunnel actually in the picture.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: `StepHealthCheck.jsx`

**Files:**
- Create: `web/src/pages/setup/StepHealthCheck.jsx`

**Interfaces:**
- Consumes: `api.updateStackInstance`, `api.saveWatchdogSettings`, `describeFailures` (Task 7).
- Produces: `props.onNext("done")` once submitted.

- [ ] **Step 1: Write the component**

```jsx
import { useState } from "react";
import { Card, Button, ErrorNote } from "../../components/common.jsx";
import { api } from "../../lib/api.js";
import { describeFailures } from "../../lib/applyToAll.js";

const FIELD =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
  "placeholder:text-slate-400 focus:border-accent-500 focus:outline-none focus:ring-1 " +
  "focus:ring-accent-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white";

export default function StepHealthCheck({ instances, onNext }) {
  const [selected, setSelected] = useState({}); // key -> bool
  const [streamIds, setStreamIds] = useState({}); // key -> string
  const [checkTimes, setCheckTimes] = useState("04:00,16:00");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function toggle(key) {
    setSelected((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const chosen = instances.filter((i) => selected[i.key]);
  const allStreamIdsFilled = chosen.every((i) => (streamIds[i.key] || "").trim());

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const results = await Promise.allSettled(
        chosen.map((i) =>
          api.updateStackInstance(i.key, {
            healthCheckEnabled: true,
            healthCheckStreamId: streamIds[i.key],
          })
        )
      );
      const failureMessage = describeFailures(
        chosen.map((i) => ({ name: i.displayName })),
        results
      );
      if (failureMessage) {
        setError(failureMessage);
        return;
      }
      await api.saveWatchdogSettings({ enabled: true, checkTimes });
      onNext("done");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">Health check</h2>
      <p className="mt-1.5 max-w-prose text-sm text-slate-500 dark:text-slate-400">
        Optional. Lets the VPN watchdog reconnect the tunnel when a provider blocks the current exit
        IP — pick which instances to watch.
      </p>

      <div className="mt-5 flex flex-col gap-2">
        {instances.map((instance) => (
          <label key={instance.key} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={!!selected[instance.key]}
              onChange={() => toggle(instance.key)}
              className="h-4 w-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
            />
            {instance.displayName}
          </label>
        ))}
      </div>

      {chosen.length > 0 && (
        <div className="mt-5 border-t border-slate-200 pt-5 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Probe channel per instance</h3>
          <div className="mt-3 flex flex-col gap-3">
            {chosen.map((instance) => (
              <label key={instance.key} className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  {instance.displayName} — Stream ID
                </span>
                <input
                  className={FIELD}
                  value={streamIds[instance.key] || ""}
                  onChange={(e) => setStreamIds((prev) => ({ ...prev, [instance.key]: e.target.value }))}
                  placeholder="12345.ts"
                />
              </label>
            ))}
          </div>

          <label className="mt-4 flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Check times (local, HH:MM)
            </span>
            <input className={FIELD} value={checkTimes} onChange={(e) => setCheckTimes(e.target.value)} />
          </label>
        </div>
      )}

      {error && (
        <div className="mt-4">
          <ErrorNote message={error} />
        </div>
      )}

      <div className="mt-5 flex items-center gap-2">
        <Button
          tone="accent"
          onClick={submit}
          loading={saving}
          disabled={saving || (chosen.length > 0 && !allStreamIdsFilled)}
        >
          {chosen.length > 0 ? "Save and continue" : "Skip"}
        </Button>
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Verify the build**

Run: `cd web && npm run build`
Expected: this is the last step file — the build should now succeed end-to-end with no missing-import errors. If you had commented out imports in Task 9, uncomment all of them now.

- [ ] **Step 3: Manual check — full wizard walkthrough**

Starting from a clean `/setup` (or a fresh install), walk the entire wizard: add two instances with different access modes, turn on VOD caching and confirm the suggested cache paths, configure an external Postgres, set a public URL + Discord on one instance and skip Caddy, turn the VPN on and fill gluetun, select one instance for health check with a stream id, and confirm you land on `StepDone` with a working "Review the stack plan" link to `/stack`. Then check the Stack page: the created instances, their caching/Discord/health-check fields, and the gluetun/Caddy-if-chosen components should all reflect exactly what was entered.

- [ ] **Step 4: Commit**

```bash
cd web
git add src/pages/setup/StepHealthCheck.jsx
git commit -m "$(cat <<'EOF'
Add StepHealthCheck: multi-select, per-instance stream IDs, check times

Completes the new wizard flow end to end.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Backend Discord fields → Task 2. ✓
- Backend cache path + `SUITE_CACHE_DIR` removal + schema-engine `any` gap + `vodCacheEnabled` default flip → Tasks 1, 3, 4, 5. ✓
- `docker-compose.yml`/README → Task 6. ✓
- Wizard architecture (one file per step, orchestrator, filtered `SchemaForm`, `describeFailures` extraction) → Tasks 7-9. ✓
- Step 1 Instances (required, add-another, 3-way access chooser) → Task 10. ✓
- Step 2 Caching (shared toggles, mandatory per-instance path with suggestion) → Task 11. ✓
- Step 3 Database → Task 12. ✓
- Step 4 External access (Part A always-shown per-instance, Part B independent Caddy question) → Task 13. ✓
- Step 5 VPN → Task 14. ✓
- Step 6 Health check (conditional on VPN, multi-select, per-instance stream ids, check times) → Task 15. ✓
- Step 7 Done → Task 9. ✓
- Client-side `dependsOn` `any` mirror (needed for Stack's existing edit form to correctly show/hide `cachePath`) → Task 8. ✓

**Placeholder scan:** no "TBD"/"TODO"/"add appropriate handling" anywhere above; every step shows real, complete code. The one explicitly-deferred item — Step 4's lack of inline validation before "Continue" on a partially-filled Discord sub-form — is called out as a known, deliberate non-blocker in Task 13's manual-check step, not hidden as an implicit gap.

**Type/signature consistency check:**
- `instances` is always `{ key, port, displayName }[]` — set once in `StepInstances` (Task 10), read identically in `StepCaching`/`StepExternalAccess`/`StepHealthCheck` (Tasks 11, 13, 15).
- `onNext`/`onBack` are both the same `setStep` function from `Setup.jsx` (Task 9) — every step calls `onNext("<id>")` with an id that exists in `STEP_LABELS`; verified each call site (`"caching"`, `"database"`, `"access"`, `"vpn"`, `"health"`, `"done"`) matches.
- `describeFailures(targets, results)` signature (Task 7) is called identically in Tasks 11, 13 (implicitly via the same shape — Task 13's Part A also uses it), and 15: always `targets` = array of `{ name }`, `results` = a same-length `Promise.allSettled` result array.
- `cachePath` is read as `values.cachePath` everywhere on the server (Tasks 4, 5) and written as `cachePath` in every client patch (Tasks 11) — no mismatched casing/naming found.
- `ready`'s new signature `(values) => ...` (Task 5) is called as `node.ready(values)` from the single call site in `reconciler.js`, with `values` being the exact object already resolved two lines above — verified the postgres entry's unchanged zero-arg `ready` still works when called with an ignored argument.
