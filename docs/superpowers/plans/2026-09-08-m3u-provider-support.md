# M3U Provider Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an instance be provisioned as either an Xtream API provider or a plain M3U playlist provider, Xtream recommended and default, via the schema's existing conditional-field mechanism.

**Architecture:** One new schema field (`providerType`, select, default `"xtream"`) on `INSTANCE_SCHEMA`, with `dependsOn`/`requiredWhen` conditions added to the existing `xtreamBaseUrl`/`xtreamUser`/`xtreamPassword`/`m3uUrl` fields — the same pattern already proven on gluetun's `vpnType`. `SchemaForm` already renders `dependsOn`-gated fields generically, so Stack's add/edit forms and the wizard's edit form need zero code changes. Only the wizard's hand-rolled add-instance form (`StepInstances.jsx`) needs new UI: a segmented toggle plus conditional fields.

**Tech Stack:** Node.js/Express backend (`node --test` for tests), React/Vite frontend, Tailwind. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-08-m3u-provider-support-design.md`

## Global Constraints

- `providerType` defaults to `"xtream"` — every existing/imported instance (no `providerType` key stored) must validate and render identically to today. No migration.
- `m3uUrl` stays visible in both modes (no `dependsOn`), only its required-ness is conditional (`requiredWhen`) — an Xtream provider with a supplementary M3U feed is existing, supported behavior and must keep working.
- "Use my provider credentials" sign-in option is hidden (not shown, not disabled) when `providerType === "m3u"` — there is no separate M3U login pair to copy, confirmed against stream-share's own README.
- Xtream is the recommended, default, first-listed option everywhere it's presented to the user.

---

### Task 1: Schema — `providerType` field and conditional Xtream/M3U requirements

**Files:**
- Modify: `server/src/schema/instance.js:39-69` (the `Provider` group's field block)
- Test: `server/test/instance.test.js` (append a new section)

**Interfaces:**
- Consumes: `validate`, `renderEnv`, `toPublicFields` from `server/src/schema/registry.js` (unchanged — this task only adds schema data, no engine changes).
- Produces: `INSTANCE_SCHEMA.fields` gains one new field, key `providerType` (`type: "select"`, `options: ["xtream", "m3u"]`, `default: "xtream"`). `xtreamBaseUrl`/`xtreamUser`/`xtreamPassword` each gain `dependsOn: { key: "providerType", equals: "xtream" }`. `m3uUrl` gains `required: true, requiredWhen: { key: "providerType", equals: "m3u" }` and loses `advanced: true`. Later tasks (Task 2) rely on these field keys (`providerType`, `xtreamBaseUrl`, `xtreamUser`, `xtreamPassword`, `m3uUrl`) and on submitting a `providerType` value alongside the rest of the patch.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/instance.test.js`, after the `// --- cache path ----------------------------------------------------------` section (the file currently ends around line 523 with the `cachePath satisfied with either caching flag on and a value given` test):

```javascript
// --- provider type ---------------------------------------------------------

test("providerType defaults to xtream, matching every existing instance's stored config", () => {
  const fields = INSTANCE_SCHEMA.fields;
  assert.equal(fields.find((f) => f.key === "providerType").default, "xtream");
});

test("xtream fields are required by default (providerType unset, same as every existing instance)", () => {
  const errors = validate(INSTANCE_SCHEMA, { displayName: "Provider 1" });
  const keys = errors.map((e) => e.key);
  assert.ok(keys.includes("xtreamBaseUrl"));
  assert.ok(keys.includes("xtreamUser"));
  assert.ok(keys.includes("xtreamPassword"));
});

test("xtream fields are hidden and not required once providerType is m3u", () => {
  const errors = validate(INSTANCE_SCHEMA, {
    displayName: "Provider 1",
    providerType: "m3u",
    m3uUrl: "http://provider.example/get.php?username=u&password=p&type=m3u_plus&output=m3u8",
  });
  const keys = errors.map((e) => e.key);
  assert.equal(keys.includes("xtreamBaseUrl"), false);
  assert.equal(keys.includes("xtreamUser"), false);
  assert.equal(keys.includes("xtreamPassword"), false);
});

test("m3uUrl is not required while providerType is xtream", () => {
  assert.equal(validate(INSTANCE_SCHEMA, PROVIDER).some((e) => e.key === "m3uUrl"), false);
});

test("m3uUrl becomes required once providerType is m3u", () => {
  const errors = validate(INSTANCE_SCHEMA, { displayName: "Provider 1", providerType: "m3u" });
  assert.equal(errors.some((e) => e.key === "m3uUrl"), true);

  const withUrl = validate(INSTANCE_SCHEMA, {
    displayName: "Provider 1",
    providerType: "m3u",
    m3uUrl: "http://provider.example/playlist.m3u",
  });
  assert.equal(withUrl.some((e) => e.key === "m3uUrl"), false);
});

test("m3uUrl stays visible (in toPublicFields) even in xtream mode, unlike a dependsOn-hidden field", () => {
  const fields = toPublicFields(INSTANCE_SCHEMA, PROVIDER);
  assert.ok(fields.some((f) => f.key === "m3uUrl"));
});

test("renderEnv emits XTREAM_* and omits M3U_URL for a default (xtream) instance", () => {
  const env = renderEnv(INSTANCE_SCHEMA, PROVIDER);
  assert.equal(env.XTREAM_BASE_URL, PROVIDER.xtreamBaseUrl);
  assert.equal(env.XTREAM_USER, PROVIDER.xtreamUser);
  assert.equal(env.XTREAM_PASSWORD, PROVIDER.xtreamPassword);
  assert.equal("M3U_URL" in env, false);
});

test("renderEnv emits M3U_URL and omits XTREAM_* for an m3u instance", () => {
  const env = renderEnv(INSTANCE_SCHEMA, {
    displayName: "Provider 1",
    providerType: "m3u",
    m3uUrl: "http://provider.example/playlist.m3u",
    authMode: "basic",
    authUser: "viewer",
    authPassword: "secret",
  });
  assert.equal(env.M3U_URL, "http://provider.example/playlist.m3u");
  assert.equal("XTREAM_BASE_URL" in env, false);
  assert.equal("XTREAM_USER" in env, false);
  assert.equal("XTREAM_PASSWORD" in env, false);
});

test("renderEnv still omits XTREAM_* for a stale value once providerType switches to m3u", () => {
  // Same "no leftover env from a mode you switched away from" guarantee
  // dependsOn already gives every other conditional field in this schema.
  const env = renderEnv(INSTANCE_SCHEMA, {
    ...PROVIDER,
    providerType: "m3u",
    m3uUrl: "http://provider.example/playlist.m3u",
  });
  assert.equal("XTREAM_BASE_URL" in env, false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && node --test test/instance.test.js`

Expected: the 8 new tests fail. Most will fail with assertion errors (e.g. `xtreamBaseUrl` not reported missing when it should be, because right now it's unconditionally required and thus IS reported for the m3u test too, or `providerType` field not found so `.default` throws). One or two may throw `TypeError: Cannot read properties of undefined (reading 'default')` for the `providerType defaults to xtream` test specifically, since the field doesn't exist yet.

- [ ] **Step 3: Implement the schema change**

In `server/src/schema/instance.js`, replace the `// --- provider -----------------------------------------------------------` block (currently `xtreamBaseUrl`, `xtreamUser`, `xtreamPassword`, `m3uUrl`, lines 38-69) with:

```javascript
    // --- provider -----------------------------------------------------------
    {
      key: "providerType",
      envVar: null,
      label: "Playlist source",
      help: "Xtream unlocks VOD, series, EPG and subscription status. Pick M3U only if your provider doesn't offer an Xtream API.",
      type: "select",
      options: ["xtream", "m3u"],
      default: "xtream",
      group: "Provider",
      required: true,
    },
    {
      key: "xtreamBaseUrl",
      envVar: "XTREAM_BASE_URL",
      label: "Xtream base URL",
      help: "Your provider's portal address, e.g. http://provider.example:8080",
      group: "Provider",
      required: true,
      dependsOn: { key: "providerType", equals: "xtream" },
    },
    {
      key: "xtreamUser",
      envVar: "XTREAM_USER",
      label: "Xtream username",
      group: "Provider",
      required: true,
      dependsOn: { key: "providerType", equals: "xtream" },
    },
    {
      key: "xtreamPassword",
      envVar: "XTREAM_PASSWORD",
      label: "Xtream password",
      group: "Provider",
      secret: true,
      required: true,
      dependsOn: { key: "providerType", equals: "xtream" },
    },
    {
      key: "m3uUrl",
      envVar: "M3U_URL",
      label: "M3U URL",
      help: "The provider's M3U playlist URL. Required for an M3U-only provider; optional if your Xtream provider also serves extra channels via M3U.",
      group: "Provider",
      required: true,
      requiredWhen: { key: "providerType", equals: "m3u" },
    },
```

Note what did **not** change: `xtreamPassword` keeps `secret: true`; every field keeps its `group: "Provider"`; `m3uUrl` no longer has `advanced: true` (it's now relevant to the primary flow in m3u mode, not a rare supplement).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && node --test test/instance.test.js`

Expected: PASS — all tests in the file, including the 8 new ones and every pre-existing test (they all use `PROVIDER`, which has no `providerType` key and so resolves to the `"xtream"` default — identical behavior to before this change).

- [ ] **Step 5: Run the full server test suite**

Run: `cd server && npm test`

Expected: PASS. This confirms nothing elsewhere (import tests, reconciler tests, stack route tests) that builds an instance's `config_json` without a `providerType` key regressed — they should all still resolve to the `"xtream"` default and behave exactly as before.

- [ ] **Step 6: Commit**

```bash
cd /root/work/stream-share-suite
git add server/src/schema/instance.js server/test/instance.test.js
git commit -m "$(cat <<'EOF'
schema: add providerType, gate Xtream fields on it, make m3uUrl conditional

New providerType select field (xtream/m3u, default xtream) on
INSTANCE_SCHEMA. xtreamBaseUrl/xtreamUser/xtreamPassword now depend on
providerType === "xtream" (hidden and not required otherwise). m3uUrl
stays visible in both modes (an Xtream provider with a supplementary
M3U feed is existing, supported behavior) but is now required only
when providerType === "m3u", and is no longer marked advanced since
it's primary in that mode.

Same dependsOn/requiredWhen mechanism already proven on gluetun's
vpnType. default: "xtream" means every existing/imported instance
(no providerType stored) resolves and behaves identically to before
this change — verified by the full existing test suite staying green.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CJT1ab1HK6BXhUAHTcAPyZ
EOF
)"
```

---

### Task 2: Wizard add-instance UI — Xtream/M3U toggle

**Files:**
- Modify: `web/src/pages/setup/StepInstances.jsx` (the `adding` form block, `blankDraft()`, `toPatch()`)

**Interfaces:**
- Consumes: `providerType`, `xtreamBaseUrl`, `xtreamUser`, `xtreamPassword`, `m3uUrl` field keys from Task 1's schema change — `api.createStackInstance(patch)` (unchanged signature, already existing) now needs `patch.providerType` set and either the three Xtream keys or `m3uUrl` present depending on it.
- Produces: nothing consumed by a later task — this is the last task in this plan. Stack's own add/edit forms and the wizard's edit form need no matching change (already schema-driven via `SchemaForm`, confirmed in the spec).

No test file for this task — the project has no frontend test runner (confirmed: only `server/test/*.test.js` exists, driven by `node --test`; every other wizard-step change this session was verified via `npm run build` plus manual reasoning about the JSX, and this task follows that same established convention rather than introducing new tooling). Verification is: the build stays clean, and a manual read-through confirms the four required behaviors below.

- [ ] **Step 1: Add the `PROVIDER_TYPES` toggle data, `blankDraft()` and `toPatch()` changes**

In `web/src/pages/setup/StepInstances.jsx`, add a new array right after the existing `ACCESS_MODES` array (before the `EDIT_GROUPS` comment):

```javascript
const PROVIDER_TYPES = [
  {
    value: "xtream",
    label: "Xtream API (recommended)",
    help: "Unlocks VOD, series, EPG and subscription status. Use this if your provider offers an Xtream API — most do.",
  },
  {
    value: "m3u",
    label: "M3U playlist",
    help: "Just a playlist link, no Xtream API. Live channels work; no VOD/series/EPG or subscription status.",
  },
];
```

Replace `blankDraft()`:

```javascript
function blankDraft() {
  return {
    displayName: "",
    providerType: "xtream",
    xtreamBaseUrl: "",
    xtreamUser: "",
    xtreamPassword: "",
    m3uUrl: "",
    accessMode: "provider",
    authUser: "",
    authPassword: "",
    ldapServer: "",
    ldapBaseDn: "",
    ldapBindDn: "",
    ldapBindPassword: "",
  };
}
```

Replace `toPatch()`'s `base` construction (keep the rest of the function — the `if (draft.accessMode === "ldap")`, `"custom"`, and `"provider"` branches below it — unchanged):

```javascript
function toPatch(draft) {
  const base = {
    displayName: draft.displayName,
    providerType: draft.providerType,
    ...(draft.providerType === "m3u"
      ? { m3uUrl: draft.m3uUrl }
      : {
          xtreamBaseUrl: draft.xtreamBaseUrl,
          xtreamUser: draft.xtreamUser,
          xtreamPassword: draft.xtreamPassword,
        }),
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
```

- [ ] **Step 2: Run the build to confirm the file still compiles**

Run: `cd web && npm run build`

Expected: PASS. (`PROVIDER_TYPES` is defined but not yet referenced in the JSX at this point — that's fine, Step 4 wires it in. No dead-code lint failure since this project's `npm run build` is a plain Vite build with no lint step.)

- [ ] **Step 3: Add the `setProviderType` handler inside the component**

In `StepInstances`, right after the existing `function set(key, value) { ... }` (inside the component body), add:

```javascript
  // Leaving Xtream mode with "provider" sign-in selected would submit a
  // patch that references xtreamUser/xtreamPassword — fields that no longer
  // exist in the draft once M3U is picked. Reset to "custom" instead of
  // letting that combination happen.
  function setProviderType(value) {
    setDraft((prev) => ({
      ...prev,
      providerType: value,
      accessMode: value === "m3u" && prev.accessMode === "provider" ? "custom" : prev.accessMode,
    }));
  }
```

- [ ] **Step 4: Wire the toggle and conditional fields into the form JSX**

Replace this block (the `Name`/Xtream-fields grid, currently the first `<div className="grid gap-3 sm:grid-cols-2">` inside the `{adding && (...)}` form):

```javascript
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
```

with:

```javascript
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
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Playlist source</span>
            <div className="flex flex-wrap gap-2">
              {PROVIDER_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setProviderType(type.value)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                    draft.providerType === type.value
                      ? "bg-accent-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                  }`}
                >
                  {type.label}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              {PROVIDER_TYPES.find((t) => t.value === draft.providerType)?.help}
            </span>
          </div>

          {draft.providerType === "xtream" ? (
            <div className="grid gap-3 sm:grid-cols-2">
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
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="M3U playlist URL"
                hint="e.g. http://provider.example/get.php?username=u&password=p&type=m3u_plus&output=m3u8"
              >
                <input
                  className={FIELD}
                  value={draft.m3uUrl}
                  onChange={(e) => set("m3uUrl", e.target.value)}
                  required
                />
              </Field>
            </div>
          )}
```

- [ ] **Step 5: Hide "Use my provider credentials" when M3U is selected**

Inside the `"How users sign in"` block, replace this entire `<div className="flex flex-wrap gap-2">...</div>` (the one that renders `ACCESS_MODES`):

```javascript
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
```

with:

```javascript
            <div className="flex flex-wrap gap-2">
              {ACCESS_MODES.filter((mode) => mode.value !== "provider" || draft.providerType === "xtream").map(
                (mode) => (
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
                )
              )}
            </div>
```

- [ ] **Step 6: Run the build**

Run: `cd web && npm run build`

Expected: PASS, clean, no errors.

- [ ] **Step 7: Manually verify the four required behaviors**

Read back through the modified render output (or run `npm run dev` and open the wizard's Instances step) and confirm:
1. Xtream is selected by default, labeled "Xtream API (recommended)", and its three fields show.
2. Clicking "M3U playlist" swaps the three Xtream fields for one "M3U playlist URL" field, and the help line below the toggle changes to the M3U copy.
3. With "Use my provider credentials" selected under "How users sign in", switching the playlist source to M3U removes that button from the row and the selection jumps to "Set custom credentials" (not left on a hidden, unselectable state).
4. Submitting the M3U form calls `api.createStackInstance` with `providerType: "m3u"`, `m3uUrl` set, and no `xtreamBaseUrl`/`xtreamUser`/`xtreamPassword` keys (check via a browser network tab or by temporarily logging `toPatch(draft)`, then remove the log).

- [ ] **Step 8: Commit**

```bash
cd /root/work/stream-share-suite
git add web/src/pages/setup/StepInstances.jsx
git commit -m "$(cat <<'EOF'
wizard: add Xtream/M3U toggle to the add-instance form

Segmented toggle above the Provider fields, same visual pattern as
the existing "How users sign in" row — "Xtream API (recommended)" /
"M3U playlist", defaulting to Xtream. Swaps the three Xtream fields
for one M3U playlist URL field. "Use my provider credentials" sign-in
option is filtered out of the row in M3U mode (no separate M3U login
pair exists to copy — confirmed against stream-share's own README);
switching to M3U while it was selected resets to "custom" rather than
leaving the draft on a mode-inconsistent selection.

Stack's own add/edit forms and the wizard's edit form need no changes
— both already render via SchemaForm, which already honors the
dependsOn/requiredWhen conditions Task 1 added to the schema.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CJT1ab1HK6BXhUAHTcAPyZ
EOF
)"
```
