# Setup Wizard Idempotency & Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Setup wizard idempotent — every step seeds itself from the stack's real current configuration instead of starting blank, and lets the operator edit what's already there, so the wizard becomes the primary way to review/adjust configuration going forward.

**Architecture:** Purely a frontend change — every capability needed (`componentFields`, `stackInstances`, `watchdogSettings`, `stackSettings`, `updateStackInstance`, `saveComponent`, `saveStackSettings`) already exists server-side. `Setup.jsx` seeds `instances` from the server on mount instead of `useState([])`. Three steps (`StepCaching`, `StepExternalAccess`, `StepHealthCheck`) gain a per-instance seeding fetch (`Promise.all` over `api.componentFields("instance", key)`) before rendering. Two steps (`StepVpn`, and the Caddy half of `StepExternalAccess`) collapse from a two-screen "ask then show form" sequence into one screen: a toggle seeded from the real setting, with the dependent form appearing inline when it's on. `StepInstances` gains an editable list of existing instances (reusing the same `componentFields` + `SchemaForm` pattern Stack's own instance editing already uses) alongside its existing add-flow, now collapsed behind a button instead of always open.

**Tech Stack:** React + Vite, no backend changes, no frontend test framework in this repo (confirmed in the original wizard plan) — verified via `npm run build` plus manual walkthrough per task.

## Global Constraints

- Every commit message ends with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- No backend changes in this plan. `cd server && npm test` should remain unaffected (381 passing as of this plan's writing) — not a required per-task check since no server file is touched, but worth a final sanity run once all tasks land.
- Frontend: `cd web && npm run build` after every task. There is no `npm test` in `web/package.json` — do not add one.
- Match existing code style exactly: comments explain *why*, not *what*.
- Reuse existing conventions: the write-only secret-field pattern ("A token/key is set. Leave blank to keep it.") already used by `Settings.jsx` and `SchemaForm.jsx`; the `Promise.allSettled` + `describeFailures` pattern already used by every multi-instance step; the `componentFields`+`SchemaForm` edit pattern already used by `Stack.jsx`'s `InstancesCard`.
- No skip logic: every step always renders, regardless of whether its configuration already looks complete.
- Never leave the repo in a state where `npm run build` fails.

## File Structure

All changes are inside `web/src/pages/Setup.jsx` and `web/src/pages/setup/*.jsx` — no new files, no files outside this directory.

- `web/src/pages/Setup.jsx` — seeds `instances` from the server on mount.
- `web/src/pages/setup/StepInstances.jsx` — existing-instances list with inline edit, add-flow collapsed behind a button.
- `web/src/pages/setup/StepCaching.jsx` — rewritten to a per-instance model, seeded from real values.
- `web/src/pages/setup/StepExternalAccess.jsx` — Part A (per-instance) seeded from real values; Part B (Caddy) collapsed into one screen with an inline toggle.
- `web/src/pages/setup/StepVpn.jsx` — collapsed into one screen with an inline toggle, seeded from the real `vpnEnabled` setting.
- `web/src/pages/setup/StepHealthCheck.jsx` — seeded from real per-instance and watchdog state.
- `web/src/pages/setup/StepDatabase.jsx` — **unchanged**, not part of this plan (already round-trips through real values via `SchemaForm`).

## Note on one deviation from the design spec's exact wording

The design spec describes the existing-instances list in `StepInstances` as showing "displayName, xtreamBaseUrl, and a human label for the current access mode." `GET /api/stack/instances` (`api.stackInstances()`), which is what seeds the list, only returns `{ key, displayName, containerName, port, url, databaseName }` — no `xtreamBaseUrl` or `authMode`. Fetching those for every instance just to populate a collapsed summary row would mean an extra `componentFields` round-trip per instance before the list even renders. Task 2 below instead shows `displayName` plus `containerName`/`url` — exactly what Stack's own `InstancesCard` already shows in its collapsed row — and defers full details (including access mode) to the same `componentFields` fetch that already has to happen once "Edit" is clicked. This keeps the initial render cheap and matches an existing convention instead of introducing a new one.

---

## Task 1: `Setup.jsx` — seed `instances` from the server on mount

**Files:**
- Modify: `web/src/pages/Setup.jsx`

**Interfaces:**
- Consumes: `api.stackInstances()` — existing, returns `{ instances: [{ key, displayName, containerName, port, url, databaseName }], portBand }`.
- Produces: `instances` state now starts populated with every existing instance (in addition to any created later in the same session via `StepInstances`'s existing `setInstances` calls) — every downstream step already consumes `instances` as a prop, so this alone is what makes them idempotent once combined with Tasks 2-6's own seeding.

- [ ] **Step 1: Make the change**

In `web/src/pages/Setup.jsx`, add `useEffect` to the React import and `api` as a new import, then seed `instances` on mount. Change:

```jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import StepInstances from "./setup/StepInstances.jsx";
```

to:

```jsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import { api } from "../lib/api.js";
import StepInstances from "./setup/StepInstances.jsx";
```

And change:

```jsx
export default function Setup() {
  const navigate = useNavigate();
  const [step, setStep] = useState("instances");
  // { key, port, displayName } per instance created this run — later steps
  // (caching, access, health) both read and patch entries here.
  const [instances, setInstances] = useState([]);

  const stepProps = { instances, setInstances, onNext: setStep };
```

to:

```jsx
export default function Setup() {
  const navigate = useNavigate();
  const [step, setStep] = useState("instances");
  // Every existing instance, plus any created later in this run via
  // StepInstances's own setInstances calls — every other step reads this
  // same list, which is what makes the whole wizard idempotent rather than
  // "first run only."
  const [instances, setInstances] = useState([]);

  useEffect(() => {
    api.stackInstances().then((r) => setInstances(r.instances));
  }, []);

  const stepProps = { instances, setInstances, onNext: setStep };
```

- [ ] **Step 2: Verify the build**

Run: `cd web && npm run build`
Expected: succeeds — `StepInstances` (Task 2) hasn't changed its prop usage yet, so `instances` now arriving with extra fields (`containerName`, `url`, `databaseName`) it doesn't read is harmless.

- [ ] **Step 3: Manual check**

With the dev server running and at least one instance already configured (via Stack, if none exist yet), navigate to `/setup` and confirm the browser's network tab shows a `GET /api/stack/instances` call, and that `StepInstances`'s existing instance list (today just showing `displayName`/`port`) includes that pre-existing instance.

- [ ] **Step 4: Commit**

```bash
cd web
git add src/pages/Setup.jsx
git commit -m "$(cat <<'EOF'
Seed Setup.jsx's instances list from the server on mount

Every downstream wizard step already reads this same list — seeding
it from api.stackInstances() instead of starting empty is what makes
the whole wizard idempotent rather than first-run-only.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `StepInstances.jsx` — existing-instances list + collapsed add-form

**Files:**
- Modify: `web/src/pages/setup/StepInstances.jsx` (full rewrite of the component body; the `ACCESS_MODES`, `Field`, `blankDraft`, `toPatch` helpers stay as they are)

**Interfaces:**
- Consumes: `api.componentFields("instance", key)` (existing), `api.updateStackInstance(key, patch)` (existing), `SchemaForm` (existing, default export from `../../components/SchemaForm.jsx`).
- Produces: no change to `StepInstances`'s own props (`{ instances, setInstances, onNext }`) or what it hands other steps — `instances` entries gain `containerName`/`url`/`databaseName` (from Task 1's seed), which this task is what actually displays them.

- [ ] **Step 1: Replace the component**

Keep everything above `export default function StepInstances` unchanged (the `ACCESS_MODES` array, `Field` helper, `blankDraft`, `toPatch` — all still used exactly as today by the add-flow). Add one constant right after the `ACCESS_MODES` array:

```jsx
// Groups editable here — Addressing/Discord/Caching/Health check/Container
// each have their own dedicated later step, so an existing instance's edit
// form shouldn't duplicate them. displayName is its own "Instance" group,
// separate from "Provider" — both need including for this to show the same
// fields the add-flow above collects.
const EDIT_GROUPS = ["Instance", "Provider", "Access"];
```

Add `SchemaForm` to the imports:

```jsx
import { Card, Button, ErrorNote, FIELD } from "../../components/common.jsx";
import SchemaForm from "../../components/SchemaForm.jsx";
import { api } from "../../lib/api.js";
```

Replace the entire `export default function StepInstances({ instances, setInstances, onNext }) { ... }` body with:

```jsx
export default function StepInstances({ instances, setInstances, onNext }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(blankDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Only one of "adding" / "editing an existing one" open at a time — same
  // convention Stack's own instance list already uses.
  const [editingKey, setEditingKey] = useState(null);
  const [editFields, setEditFields] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState(null);

  useEffect(() => {
    if (!editingKey || editFields) return;
    api.componentFields("instance", editingKey).then((res) => {
      setEditFields(res.fields.filter((f) => EDIT_GROUPS.includes(f.group)));
    });
  }, [editingKey, editFields]);

  function set(key, value) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function toggleAdding() {
    setEditingKey(null);
    setEditFields(null);
    setAdding((v) => !v);
    setError(null);
  }

  function toggleEditing(key) {
    setAdding(false);
    setError(null);
    setEditingKey((current) => (current === key ? null : key));
    setEditFields(null);
    setEditError(null);
  }

  async function addInstance(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { key, port } = await api.createStackInstance(toPatch(draft));
      setInstances((prev) => [...prev, { key, port, displayName: draft.displayName }]);
      setDraft(blankDraft());
      setAdding(false);
    } catch (err) {
      setError(err.body?.errors?.map((e) => e.message).join(" ") || err.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(patch) {
    setEditSaving(true);
    setEditError(null);
    try {
      await api.updateStackInstance(editingKey, patch);
      setInstances((prev) =>
        prev.map((i) => (i.key === editingKey ? { ...i, displayName: patch.displayName } : i))
      );
      setEditingKey(null);
      setEditFields(null);
    } catch (err) {
      setEditError(err.body?.errors?.map((e) => e.message).join(" ") || err.message);
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">Your instances</h2>
      <p className="mt-1.5 max-w-prose text-sm text-slate-500 dark:text-slate-400">
        One StreamShare instance per IPTV provider. At least one is required.
      </p>

      {instances.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {instances.map((i) => (
            <li key={i.key} className="rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                    {i.displayName}
                  </p>
                  {(i.containerName || i.url) && (
                    <p className="truncate text-xs text-slate-400">
                      {[i.containerName, i.url].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => toggleEditing(i.key)}
                  className="shrink-0 text-xs font-medium text-accent-600 hover:underline dark:text-accent-400"
                >
                  {editingKey === i.key ? "Hide" : "Edit"}
                </button>
              </div>

              {editingKey === i.key && (
                <div className="border-t border-slate-200 px-3 py-3 dark:border-slate-800">
                  {editFields === null ? (
                    <p className="text-sm text-slate-400">Loading…</p>
                  ) : (
                    <SchemaForm
                      fields={editFields}
                      onSave={saveEdit}
                      saving={editSaving}
                      error={editError}
                      submitLabel="Save changes"
                    />
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4">
        <Button type="button" tone="ghost" onClick={toggleAdding}>
          {adding ? "Cancel" : "+ Add another instance"}
        </Button>
      </div>

      {adding && (
        <form
          onSubmit={addInstance}
          className="mt-4 flex flex-col gap-5 border-t border-slate-200 pt-4 dark:border-slate-800"
        >
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

          <div>
            <Button type="submit" tone="accent" loading={saving} disabled={saving}>
              Add instance
            </Button>
          </div>
        </form>
      )}

      <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
        <Button type="button" tone="accent" onClick={() => onNext("caching")} disabled={instances.length === 0}>
          {instances.length === 0
            ? "Add at least one instance to continue"
            : `Continue with ${instances.length} instance${instances.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </Card>
  );
}
```

Also change the top-of-file React import to include `useEffect` (it currently only imports `useState`):

```jsx
import { useEffect, useState } from "react";
```

- [ ] **Step 2: Verify the build**

Run: `cd web && npm run build`

- [ ] **Step 3: Manual check**

With at least one pre-existing instance (seeded by Task 1) and the dev server running: confirm it appears in the list with its container name/URL; click "Edit," confirm the form loads (Instance/Provider/Access fields only — no Discord, caching, or container fields), edit the display name, save, and confirm the list updates without a page reload. Click "+ Add another instance," confirm the existing add-flow still works exactly as before, and that the button toggles to "Cancel" and back correctly. Confirm "Continue" is disabled with zero instances and enabled otherwise.

- [ ] **Step 4: Commit**

```bash
cd web
git add src/pages/setup/StepInstances.jsx
git commit -m "$(cat <<'EOF'
StepInstances: editable existing-instance list, add-form collapsed

Existing instances now show in a list with an Edit toggle reusing the
same componentFields+SchemaForm pattern Stack's own instance editing
already uses (filtered to Instance/Provider/Access — the other groups
each have their own later wizard step). Adding a new instance moves
behind a "+ Add another instance" button instead of always being open.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `StepCaching.jsx` — per-instance instead of shared

**Files:**
- Modify: `web/src/pages/setup/StepCaching.jsx` (full rewrite)

**Interfaces:**
- Consumes: `api.componentFields("instance", key)` (existing), `api.updateStackInstance(key, patch)` (existing), `describeFailures` (existing, from `../../lib/applyToAll.js`).
- Produces: no change to `StepCaching`'s own props (`{ instances, onNext }`) or its `onNext("database")` call.

- [ ] **Step 1: Replace the file**

Replace the entire contents of `web/src/pages/setup/StepCaching.jsx` with:

```jsx
import { useEffect, useState } from "react";
import { Card, Button, ErrorNote, FIELD } from "../../components/common.jsx";
import { api } from "../../lib/api.js";
import { describeFailures } from "../../lib/applyToAll.js";

export default function StepCaching({ instances, onNext }) {
  const [byKey, setByKey] = useState(null); // null until seeded
  const [parentPath, setParentPath] = useState("");
  // key -> the last value auto-suggested for it, so typing a new parent path
  // knows whether to re-suggest (untouched) or leave a hand-edited path alone.
  const [suggestedFor, setSuggestedFor] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all(instances.map((i) => api.componentFields("instance", i.key))).then((results) => {
      const seeded = {};
      results.forEach((res, idx) => {
        const values = Object.fromEntries(res.fields.map((f) => [f.key, f.value]));
        seeded[instances[idx].key] = {
          vodCacheEnabled: values.vodCacheEnabled === "true",
          catchupEnabled: values.catchupEnabled === "true",
          catchupDurationHours: values.catchupDurationHours || "4",
          cachePath: values.cachePath || "",
        };
      });
      setByKey(seeded);
    });
    // Runs once, when this step is first shown — the instance list doesn't
    // change while this step is on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function patch(key, fields) {
    setByKey((prev) => ({ ...prev, [key]: { ...prev[key], ...fields } }));
  }

  function updateParentPath(value) {
    setParentPath(value);
    const trimmedRoot = value.replace(/\/+$/, "");
    const suggestions = Object.fromEntries(
      instances.map((i) => [i.key, value ? `${trimmedRoot}/${i.key}` : ""])
    );

    setByKey((prev) => {
      const next = { ...prev };
      for (const instance of instances) {
        const current = prev[instance.key];
        // Only overwrite a path that's still blank or still exactly the
        // previous suggestion — an existing or hand-typed path is left alone.
        if (!current.cachePath || current.cachePath === suggestedFor[instance.key]) {
          next[instance.key] = { ...current, cachePath: suggestions[instance.key] };
        }
      }
      return next;
    });
    setSuggestedFor(suggestions);
  }

  const allPathsFilled =
    byKey !== null &&
    instances.every((i) => {
      const values = byKey[i.key];
      const cachingOn = values.vodCacheEnabled || values.catchupEnabled;
      return !cachingOn || values.cachePath.trim();
    });

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const results = await Promise.allSettled(
        instances.map((i) => {
          const values = byKey[i.key];
          const cachingOn = values.vodCacheEnabled || values.catchupEnabled;
          return api.updateStackInstance(i.key, {
            vodCacheEnabled: values.vodCacheEnabled ? "true" : "false",
            catchupEnabled: values.catchupEnabled ? "true" : "false",
            ...(values.catchupEnabled ? { catchupDurationHours: values.catchupDurationHours } : {}),
            ...(cachingOn ? { cachePath: values.cachePath } : {}),
          });
        })
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

  if (byKey === null) {
    return (
      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Caching</h2>
        <p className="mt-5 text-sm text-slate-400">Loading…</p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">Caching</h2>
      <p className="mt-1.5 max-w-prose text-sm text-slate-500 dark:text-slate-400">
        Per instance — each one keeps whatever it's already set to until you change it here.
      </p>

      <label className="mt-4 flex flex-col gap-1.5">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
          Parent folder on the Docker host (optional convenience)
        </span>
        <input
          className={FIELD}
          value={parentPath}
          onChange={(e) => updateParentPath(e.target.value)}
          placeholder="/mnt/user/cache/stream-share-suite"
        />
        <span className="text-[11px] text-slate-400 dark:text-slate-500">
          Suggests a subfolder below for any instance that doesn't already have a cache path.
        </span>
      </label>

      <div className="mt-5 flex flex-col gap-5">
        {instances.map((instance) => {
          const values = byKey[instance.key];
          const cachingOn = values.vodCacheEnabled || values.catchupEnabled;
          return (
            <div
              key={instance.key}
              className="border-t border-slate-200 pt-4 first:border-t-0 first:pt-0 dark:border-slate-800"
            >
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{instance.displayName}</h3>
              <div className="mt-2 flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={values.vodCacheEnabled}
                    onChange={(e) => patch(instance.key, { vodCacheEnabled: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
                  />
                  Cache VOD locally
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={values.catchupEnabled}
                    onChange={(e) => patch(instance.key, { catchupEnabled: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
                  />
                  Buffer live channels for catchup
                </label>
                {values.catchupEnabled && (
                  <label className="ml-6 flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                      Hours of catchup to keep
                    </span>
                    <input
                      type="number"
                      min="1"
                      className={`${FIELD} w-32`}
                      value={values.catchupDurationHours}
                      onChange={(e) => patch(instance.key, { catchupDurationHours: e.target.value })}
                    />
                  </label>
                )}
              </div>

              {cachingOn && (
                <label className="mt-3 flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Cache location on this host
                  </span>
                  <input
                    className={FIELD}
                    value={values.cachePath}
                    onChange={(e) => patch(instance.key, { cachePath: e.target.value })}
                  />
                </label>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="mt-4">
          <ErrorNote message={error} />
        </div>
      )}

      <div className="mt-5">
        <Button tone="accent" onClick={submit} loading={saving} disabled={saving || !allPathsFilled}>
          Continue
        </Button>
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Verify the build**

Run: `cd web && npm run build`

- [ ] **Step 3: Manual check**

With at least two instances (one with VOD caching already on and a real `cachePath` set via Stack, one with caching off): enter the wizard through to this step and confirm the already-caching instance shows its checkbox checked and its real path pre-filled, while the other shows unchecked/blank. Type a parent folder path and confirm only the *blank* instance's path field updates with a suggestion — the already-configured one stays untouched. Hand-edit a suggested path, then change the parent folder again, and confirm the hand-edited one no longer gets overwritten. Click Continue and confirm both instances' actual stored values reflect what was shown.

- [ ] **Step 4: Commit**

```bash
cd web
git add src/pages/setup/StepCaching.jsx
git commit -m "$(cat <<'EOF'
StepCaching: per-instance instead of one shared toggle for everyone

Each instance shows and edits its own current VOD-cache/catchup/path
state, seeded from real stored values. The shared-parent-path
suggestion convenience is kept but now only offers itself to
instances that don't already have a cache path set.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `StepExternalAccess.jsx` — seed Part A, restructure Part B

**Files:**
- Modify: `web/src/pages/setup/StepExternalAccess.jsx` (full rewrite)

**Interfaces:**
- Consumes: `api.componentFields("instance", key)` (existing), `api.stackSettings()` (existing, returns `{ vpnEnabled, caddyEnabled, instancePortStart, containerPrefix }`), `api.saveStackSettings(payload)` (existing), `api.componentFields("caddy")` (existing), `api.saveComponent("caddy", patch)` (existing), `SchemaForm` (existing).
- Produces: no change to `StepExternalAccess`'s own props (`{ instances, onNext }`); still calls `onNext("vpn")`, now only from Part A's Continue button (Caddy's own save no longer navigates anywhere — it's an independent, always-available toggle on the same screen).

- [ ] **Step 1: Replace the file**

Replace the entire contents of `web/src/pages/setup/StepExternalAccess.jsx` with:

```jsx
import { useEffect, useState } from "react";
import { Card, Button, ErrorNote, FIELD } from "../../components/common.jsx";
import SchemaForm from "../../components/SchemaForm.jsx";
import { api } from "../../lib/api.js";
import { describeFailures } from "../../lib/applyToAll.js";

export default function StepExternalAccess({ instances, onNext }) {
  const [byKey, setByKey] = useState(null); // null until seeded
  const [savingPartA, setSavingPartA] = useState(false);
  const [errorA, setErrorA] = useState(null);

  const [caddyEnabled, setCaddyEnabled] = useState(null); // null until seeded
  const [caddyFields, setCaddyFields] = useState(null);
  const [savingCaddy, setSavingCaddy] = useState(false);
  const [errorB, setErrorB] = useState(null);

  useEffect(() => {
    Promise.all(instances.map((i) => api.componentFields("instance", i.key))).then((results) => {
      const seeded = {};
      results.forEach((res, idx) => {
        const byFieldKey = Object.fromEntries(res.fields.map((f) => [f.key, f]));
        seeded[instances[idx].key] = {
          publicBaseUrl: byFieldKey.publicBaseUrl?.value || "",
          discordEnabled: !!byFieldKey.discordEnabled?.value,
          discordBotToken: "",
          discordBotTokenSet: !!byFieldKey.discordBotToken?.valueSet,
          discordAdminRoleId: byFieldKey.discordAdminRoleId?.value || "",
        };
      });
      setByKey(seeded);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.stackSettings().then((s) => setCaddyEnabled(s.caddyEnabled));
  }, []);

  useEffect(() => {
    if (caddyEnabled && !caddyFields) api.componentFields("caddy").then((r) => setCaddyFields(r.fields));
  }, [caddyEnabled, caddyFields]);

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
          const p = { publicBaseUrl: values.publicBaseUrl, discordEnabled: values.discordEnabled };
          if (values.discordEnabled) {
            // Blank means "leave the stored token alone" — same write-only
            // convention every secret field in this app already follows.
            if (values.discordBotToken.trim()) p.discordBotToken = values.discordBotToken;
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
      onNext("vpn");
    } finally {
      setSavingPartA(false);
    }
  }

  async function toggleCaddy(enabled) {
    setErrorB(null);
    try {
      await api.saveStackSettings({ caddyEnabled: enabled });
      setCaddyEnabled(enabled);
    } catch (err) {
      setErrorB(err.message);
    }
  }

  async function saveCaddy(caddyPatch) {
    setSavingCaddy(true);
    setErrorB(null);
    try {
      await api.saveComponent("caddy", caddyPatch);
    } catch (err) {
      setErrorB(err.body?.errors?.map((e) => e.message).join(" ") || err.message);
    } finally {
      setSavingCaddy(false);
    }
  }

  if (byKey === null || caddyEnabled === null) {
    return (
      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">External access</h2>
        <p className="mt-5 text-sm text-slate-400">Loading…</p>
      </Card>
    );
  }

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
            <div
              key={instance.key}
              className="border-t border-slate-200 pt-4 first:border-t-0 first:pt-0 dark:border-slate-800"
            >
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{instance.displayName}</h3>
              <label className="mt-3 flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Public base URL</span>
                <input
                  className={FIELD}
                  value={values.publicBaseUrl}
                  onChange={(e) => {
                    const publicBaseUrl = e.target.value;
                    patch(
                      instance.key,
                      publicBaseUrl.trim()
                        ? { publicBaseUrl }
                        : { publicBaseUrl, discordEnabled: false, discordBotToken: "", discordAdminRoleId: "" }
                    );
                  }}
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
                      placeholder={values.discordBotTokenSet ? "••••••••  (unchanged)" : ""}
                      onChange={(e) => patch(instance.key, { discordBotToken: e.target.value })}
                    />
                    <span className="text-[11px] text-slate-400 dark:text-slate-500">
                      {values.discordBotTokenSet
                        ? "A token is set. Leave blank to keep it, or type a new one to replace it."
                        : "Required to enable Discord."}
                    </span>
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

      <div className="mt-6 border-t border-slate-200 pt-5 dark:border-slate-800">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          Also reach it from your local network?
        </h3>
        <p className="mt-1 max-w-prose text-xs text-slate-500 dark:text-slate-400">
          This is what Caddy is for, and only for this — it's independent of Discord and of whether
          you set a public URL above. You're still responsible for pointing that URL's DNS at this
          host; Caddy then routes it to the right instance and port once it arrives here.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={caddyEnabled}
            onChange={(e) => toggleCaddy(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
          />
          Publish instances through Caddy
        </label>

        {caddyEnabled && (
          <div className="mt-3">
            {caddyFields === null ? (
              <p className="text-sm text-slate-400">Loading…</p>
            ) : (
              <SchemaForm
                fields={caddyFields.filter((f) => f.group === "HTTPS")}
                onSave={saveCaddy}
                saving={savingCaddy}
                error={errorB}
                submitLabel="Save"
              />
            )}
          </div>
        )}
        {errorB && !caddyEnabled && (
          <div className="mt-3">
            <ErrorNote message={errorB} />
          </div>
        )}
      </div>
    </Card>
  );
}
```

Note the `discordEnabled` key is now always included in the per-instance patch (`p.discordEnabled = values.discordEnabled` unconditionally), unlike the original version which only ever sent `discordEnabled: true` and never explicitly turned it off — needed now so that an instance which already has Discord on can have it turned back off through this same screen.

- [ ] **Step 2: Verify the build**

Run: `cd web && npm run build`

- [ ] **Step 3: Manual check**

With one instance that already has a public base URL and Discord configured (bot token set), and Caddy already off: enter this step and confirm that instance's URL and Discord checkbox are pre-checked, the bot token field shows the "already set" placeholder/hint rather than a real value, and the admin role ID (if any) is pre-filled. Leave the bot token blank and click Continue; confirm (via Stack) the stored token is unchanged. Then come back to this step (re-run the wizard) and toggle Caddy on — confirm its HTTPS form appears inline on the same screen, fill it in, click Save, and confirm `caddyEnabled` is now on without navigating away. Toggle Caddy back off and confirm the form disappears and the setting is saved as off.

- [ ] **Step 4: Commit**

```bash
cd web
git add src/pages/setup/StepExternalAccess.jsx
git commit -m "$(cat <<'EOF'
StepExternalAccess: seed from real state, fold Caddy into one screen

Part A's per-instance fields (public URL, Discord) now seed from each
instance's actual stored values instead of starting blank; an
already-set bot token shows the same write-only "leave blank to keep
it" hint used elsewhere in this app. Part B (Caddy) changes from a
two-screen ask-then-form sequence into one screen with an inline
toggle, seeded from the real caddyEnabled setting — also fixes there
being no way back to "off" once Caddy was turned on.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `StepVpn.jsx` — same toggle+inline-form restructuring

**Files:**
- Modify: `web/src/pages/setup/StepVpn.jsx` (full rewrite)

**Interfaces:**
- Consumes: `api.stackSettings()` (existing), `api.saveStackSettings(payload)` (existing), `api.componentFields("gluetun")` (existing), `api.saveComponent("gluetun", patch)` (existing), `SchemaForm` (existing).
- Produces: no change to `StepVpn`'s own props (`{ onNext }`); still calls `onNext("health")` from the gluetun form's save and `onNext("done")` when VPN is off — now reachable both by toggling off and by clicking Continue when it was already off on entry.

- [ ] **Step 1: Replace the file**

Replace the entire contents of `web/src/pages/setup/StepVpn.jsx` with:

```jsx
import { useEffect, useState } from "react";
import { Card, Button, ErrorNote } from "../../components/common.jsx";
import SchemaForm from "../../components/SchemaForm.jsx";
import { api } from "../../lib/api.js";

export default function StepVpn({ onNext }) {
  const [vpnEnabled, setVpnEnabled] = useState(null); // null until seeded
  const [fields, setFields] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.stackSettings().then((s) => setVpnEnabled(s.vpnEnabled));
  }, []);

  useEffect(() => {
    if (vpnEnabled && !fields) api.componentFields("gluetun").then((r) => setFields(r.fields));
  }, [vpnEnabled, fields]);

  async function toggleVpn(enabled) {
    setError(null);
    try {
      await api.saveStackSettings({ vpnEnabled: enabled });
      setVpnEnabled(enabled);
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

  if (vpnEnabled === null) {
    return (
      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">VPN</h2>
        <p className="mt-5 text-sm text-slate-400">Loading…</p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">Route traffic through a VPN?</h2>
      <p className="mt-1.5 max-w-prose text-sm text-slate-500 dark:text-slate-400">
        Recommended if your provider restricts access by location or IP. Every instance shares one
        tunnel — this isn't per-instance.
      </p>

      {error && (
        <div className="mt-3">
          <ErrorNote message={error} />
        </div>
      )}

      <label className="mt-4 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
        <input
          type="checkbox"
          checked={vpnEnabled}
          onChange={(e) => toggleVpn(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
        />
        Use a VPN
      </label>

      {vpnEnabled ? (
        <div className="mt-5 border-t border-slate-200 pt-5 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Gluetun (VPN)</h3>
          <p className="mt-1 max-w-prose text-xs text-slate-500 dark:text-slate-400">
            The tunnel every instance's traffic will route through. This container also publishes
            every instance's port.
          </p>
          <div className="mt-4">
            {fields === null ? (
              <p className="text-sm text-slate-400">Loading…</p>
            ) : (
              <SchemaForm
                fields={fields}
                onSave={saveGluetun}
                saving={saving}
                error={error}
                submitLabel="Save and continue"
              />
            )}
          </div>
        </div>
      ) : (
        <div className="mt-5">
          <Button tone="accent" onClick={() => onNext("done")}>
            Continue
          </Button>
        </div>
      )}
    </Card>
  );
}
```

Note `error` is passed to both the standalone `ErrorNote` above the toggle (for `toggleVpn`'s own failures) and as `SchemaForm`'s `error` prop (for `saveGluetun`'s failures) — this mirrors how other steps in this wizard already reuse one `error` state across more than one action on the same screen.

- [ ] **Step 2: Verify the build**

Run: `cd web && npm run build`

- [ ] **Step 3: Manual check**

With VPN already on (via Stack) and gluetun already configured: enter this step and confirm the toggle is already checked and the gluetun form is pre-filled with current values, not blank. Toggle it off and confirm it saves immediately and the form disappears, replaced by a bare "Continue" button. Toggle it back on and confirm the (now blank, since a fresh gluetun config was never re-fetched after turning off — the existing `fields` state is only cleared if you reload the step) form reappears; re-run the whole wizard from `/setup` afterward and confirm it once again correctly loads gluetun's actual current values fresh, whatever they ended up being.

- [ ] **Step 4: Commit**

```bash
cd web
git add src/pages/setup/StepVpn.jsx
git commit -m "$(cat <<'EOF'
StepVpn: fold the yes/no + gluetun form into one screen, seeded

Same restructuring as StepExternalAccess's Caddy toggle: seeded from
the real vpnEnabled setting, gluetun form appears inline when on
instead of on a separate screen with no way back — fixes there being
no path to turn VPN back off once it had been turned on.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `StepHealthCheck.jsx` — seed from real state

**Files:**
- Modify: `web/src/pages/setup/StepHealthCheck.jsx` (full rewrite)

**Interfaces:**
- Consumes: `api.componentFields("instance", key)` (existing), `api.watchdogSettings()` (existing, returns `{ enabled, checkTimes, maxReconnects }`), `api.updateStackInstance(key, patch)` (existing), `api.saveWatchdogSettings(payload)` (existing), `describeFailures` (existing).
- Produces: no change to `StepHealthCheck`'s own props (`{ instances, onNext }`) or its `onNext("done")` call.

- [ ] **Step 1: Replace the file**

Replace the entire contents of `web/src/pages/setup/StepHealthCheck.jsx` with:

```jsx
import { useEffect, useState } from "react";
import { Card, Button, ErrorNote, FIELD } from "../../components/common.jsx";
import { api } from "../../lib/api.js";
import { describeFailures } from "../../lib/applyToAll.js";

export default function StepHealthCheck({ instances, onNext }) {
  const [selected, setSelected] = useState(null); // null until seeded; then key -> bool
  const [streamIds, setStreamIds] = useState({}); // key -> string
  const [checkTimes, setCheckTimes] = useState(null); // null until seeded
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all(instances.map((i) => api.componentFields("instance", i.key))).then((results) => {
      const seededSelected = {};
      const seededStreamIds = {};
      results.forEach((res, idx) => {
        const byFieldKey = Object.fromEntries(res.fields.map((f) => [f.key, f]));
        const key = instances[idx].key;
        seededSelected[key] = !!byFieldKey.healthCheckEnabled?.value;
        seededStreamIds[key] = byFieldKey.healthCheckStreamId?.value || "";
      });
      setSelected(seededSelected);
      setStreamIds(seededStreamIds);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.watchdogSettings().then((s) => setCheckTimes(s.checkTimes));
  }, []);

  function toggle(key) {
    setSelected((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const loaded = selected !== null && checkTimes !== null;
  const chosen = loaded ? instances.filter((i) => selected[i.key]) : [];
  const allStreamIdsFilled = chosen.every((i) => (streamIds[i.key] || "").trim());

  async function submit() {
    if (chosen.length === 0) {
      onNext("done");
      return;
    }
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

  if (!loaded) {
    return (
      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Health check</h2>
        <p className="mt-5 text-sm text-slate-400">Loading…</p>
      </Card>
    );
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

- [ ] **Step 3: Manual check**

With one instance already health-check-enabled (real `healthCheckStreamId` set via Stack) and the watchdog's `checkTimes` already customized away from the default: enter this step (VPN must be on to reach it) and confirm that instance is pre-checked with its real stream ID shown, and the check-times field shows the actual saved value, not `04:00,16:00`. Uncheck it, click "Save and continue" (button label should still read that way if any OTHER instance stays selected, or "Skip" if none are), and confirm via Stack that instance's `healthCheckEnabled` is now off.

- [ ] **Step 4: Commit**

```bash
cd web
git add src/pages/setup/StepHealthCheck.jsx
git commit -m "$(cat <<'EOF'
StepHealthCheck: seed from real per-instance and watchdog state

Multi-select and Stream ID inputs now seed from each instance's
actual healthCheckEnabled/healthCheckStreamId; check-times seeds from
the real saved watchdog setting instead of a hardcoded default (which
only ever applied because the server itself falls back to it when
nothing has been saved yet).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Setup.jsx seeds instances on mount → Task 1. ✓
- StepInstances: existing list + edit (reusing componentFields+SchemaForm, group-filtered) + collapsed add-form, no removal → Task 2. ✓
- StepCaching: per-instance model, parent-path convenience scoped to path-less instances → Task 3. ✓
- StepExternalAccess: Part A seeded, secret write-only convention; Part B folded into one screen → Task 4. ✓
- StepVpn: folded into one screen, seeded, toggle-off supported → Task 5. ✓
- StepHealthCheck: seeded from real per-instance + watchdog state → Task 6. ✓
- StepDatabase unchanged → correctly excluded from the File Structure and every task. ✓
- No skip logic anywhere in any task. ✓
- No instance removal capability added anywhere. ✓
- No plan/apply/job-log/import/history capability added anywhere. ✓

**Placeholder scan:** no "TBD"/"TODO"/"add appropriate handling" in any task — every step shows complete, real code.

**Type/signature consistency check:**
- `instances` stays `{ key, displayName, port, containerName?, url?, databaseName? }[]` throughout — Task 1 is the only place the richer shape originates (from `api.stackInstances()`), and Task 2 is the only consumer of the extra `containerName`/`url` fields; Tasks 3, 4, 6 only ever read `.key`/`.displayName`, unaffected by the extra fields being present.
- `describeFailures(targets, results)` called identically in Tasks 3, 4 (Part A), 6 — always `targets = instances.map(i => ({ name: i.displayName }))` (or `chosen.map(...)` in Task 6), `results` the matching `Promise.allSettled` array.
- `EDIT_GROUPS` (Task 2) and the Caddy `f.group === "HTTPS"` filter (Task 4, unchanged from the original plan) both rely on `componentFields`'s returned `field.group` string — verified against the real schema group names (`Instance`, `Provider`, `Access`, `HTTPS`) already used elsewhere in this codebase, not invented here.
- `byFieldKey.<field>?.value` / `?.valueSet` (Tasks 3, 4, 6) matches `toPublicFields`'s actual projection shape (`{ key, value }` for a normal field, `{ key, valueSet }` for a secret one) — confirmed by reading `server/src/schema/registry.js`'s `toPublicFields` during this plan's research, not assumed.
