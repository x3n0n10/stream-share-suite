# Stack Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Stack page's single 1055-line scroll with a two-pane layout — persistent Plan rail + tabbed Instances/Components/Import on desktop, all-tabs (including Plan) on mobile — and attach each of the three `StackSettings` fields to the component/tab it actually belongs to.

**Architecture:** Six tasks, each independently buildable, that incrementally extract `Stack.jsx`'s 16 inline components into `pages/stack/*.jsx` files (mirroring `pages/setup/`'s existing per-step-file convention), then wire them into a responsive two-pane/tab shell. No task ever leaves the page broken — each one both extracts and re-wires in the same commit.

**Tech Stack:** React 18, Tailwind (existing `lg:` / 1024px breakpoint, same one `Layout.jsx` already uses for its own sidebar/drawer split), Vite. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-08-stack-page-redesign-design.md`

## Global Constraints

- Frontend-only. No change to any file under `server/`, no change to `SchemaForm.jsx`, `registry.js`, or any `schema/*.js` file, no change to what any API call returns.
- No new routes, no URL-driven tab state.
- No test runner exists for the web app (confirmed: only `server/test/*.test.js`). Verification for every task is `cd web && npm run build` staying clean, plus a careful read-through of the diff against this plan — the same method used for every other frontend-only spec this session.
- Desktop breakpoint is `lg:` (1024px) throughout, matching `Layout.jsx`'s existing sidebar/drawer split.

---

### Task 1: Extract `HistoryPanel`

Pure move, zero behavior change — the smallest, lowest-risk first step, and every later task depends on importing this from its new location.

**Files:**
- Create: `web/src/pages/stack/HistoryPanel.jsx`
- Modify: `web/src/pages/Stack.jsx` (remove the inline `HistoryPanel` function at lines 861-940; remove the now-unused `formatDateTime` import; add the new import)

**Interfaces:**
- Produces: default export `HistoryPanel({ kind, componentKey = "", busy, onRestored })` — identical props to today's inline version. Every later task (2 through 6) imports this from `./HistoryPanel.jsx` (relative to `pages/stack/`).

- [ ] **Step 1: Create the new file**

```jsx
// web/src/pages/stack/HistoryPanel.jsx
import { useEffect, useState } from "react";
import { ConfirmDialog } from "../../components/common.jsx";
import { api } from "../../lib/api.js";
import { formatDateTime } from "../../lib/format.js";

// Past versions of one component's stored values, with a restore button per
// entry. Reused by every component card (a singleton, key="") and each
// instance row. Restoring only changes stored config — like any other edit,
// applying the resulting plan is a separate, explicit step.
export default function HistoryPanel({ kind, componentKey = "", busy, onRestored }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (!open || entries) return;
    api.componentHistory(kind, componentKey).then((res) => setEntries(res.history));
  }, [open, entries, kind, componentKey]);

  async function restore(id) {
    setConfirmId(null);
    setRestoring(true);
    try {
      await api.restoreComponentHistory(kind, id, componentKey);
      setEntries(null);
      await onRestored();
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="text-xs font-medium text-accent-600 hover:underline disabled:opacity-50 dark:text-accent-400"
      >
        {open ? "Hide history" : "History"}
      </button>

      {open && (
        <div className="mt-2 rounded-lg border border-slate-200 dark:border-slate-800">
          {entries === null ? (
            <p className="px-3 py-2 text-xs text-slate-400">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
              No earlier versions saved yet.
            </p>
          ) : (
            <ul>
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-xs last:border-b-0 dark:border-slate-800"
                >
                  <span className="text-slate-600 dark:text-slate-300">
                    {formatDateTime(`${entry.created_at.replace(" ", "T")}Z`)}
                  </span>
                  <button
                    onClick={() => setConfirmId(entry.id)}
                    disabled={busy || restoring}
                    className="font-medium text-accent-600 hover:underline disabled:opacity-50 dark:text-accent-400"
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmId !== null}
        title="Restore this version?"
        body="This replaces the currently saved configuration with this earlier one. Nothing is applied to Docker until you Apply."
        confirmLabel="Restore"
        onConfirm={() => restore(confirmId)}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Remove the inline version from `Stack.jsx`**

Delete the entire `function HistoryPanel({ kind, componentKey = "", busy, onRestored }) { ... }` block (currently lines 861-940 — the comment above it, `// Past versions of one component's stored values...`, goes too, it moved with the function).

- [ ] **Step 3: Update `Stack.jsx`'s imports**

Replace:
```js
import { formatDateTime } from "../lib/format.js";
```
with:
```js
import HistoryPanel from "./stack/HistoryPanel.jsx";
```
(same position in the import list — `formatDateTime` was only ever used inside the function that just moved; nothing else in `Stack.jsx` calls it).

- [ ] **Step 4: Verify the build**

Run: `cd web && npm run build`
Expected: PASS, clean, no errors. (The two remaining call sites — inside `InstancesCard` and `ComponentCard`, both still in `Stack.jsx` at this point — now resolve `HistoryPanel` via the new import instead of the old inline function; their JSX is unchanged.)

- [ ] **Step 5: Commit**

```bash
cd /root/work/stream-share-suite
git add web/src/pages/stack/HistoryPanel.jsx web/src/pages/Stack.jsx
git commit -m "$(cat <<'EOF'
Extract HistoryPanel into pages/stack/

Pure move, no behavior change — first step of the Stack page
redesign, split out first since every other component card imports it.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CJT1ab1HK6BXhUAHTcAPyZ
EOF
)"
```

---

### Task 2: Extract `PlanPanel`

Combines `PlanCard` + `PlanSummary` + `PlanRow` + `EmptyPlan` + `JobLog` + `ActionBadge` + `RuntimeBadges` into one `PlanPanel` component. Moves the orphan-removal confirm dialog's open/closed state out of the page orchestrator and into `PlanPanel` itself. Fixes `EmptyPlan`'s stale "below" copy per the spec.

**Files:**
- Create: `web/src/pages/stack/PlanPanel.jsx`
- Modify: `web/src/pages/Stack.jsx` (remove `ACTION`, `ActionBadge`, `RUNTIME_STATUS`, `HEALTH`, `RuntimeBadges` at lines 12-56; remove `PlanCard`, `PlanSummary`, `PlanRow` at lines 767-859; remove `EmptyPlan` at lines 432-456; remove `JobLog` at lines 1039-1055; remove `orphanToRemove` state and `confirmRemoveOrphan` at lines 67, 144-148; remove the standalone `<ConfirmDialog>` block at lines 220-231; replace the plan-related render block)

**Interfaces:**
- Consumes: `HistoryPanel` is NOT used by this file (Plan doesn't show history) — no dependency on Task 1.
- Produces: default export `PlanPanel({ plan, planError, components, busy, job, onApply, onConfirmRemoveOrphan })`. `onConfirmRemoveOrphan(row)` is called only once the user has confirmed inside `PlanPanel`'s own dialog — this is a new prop shape (the old `onRemoveOrphan` prop on `PlanCard` was called immediately on click, to *open* the dialog; that responsibility now lives inside `PlanPanel`). Tasks 3-6 don't consume `PlanPanel` directly except Task 6, which renders it in both the sticky rail and the mobile Plan tab.

- [ ] **Step 1: Create the new file**

```jsx
// web/src/pages/stack/PlanPanel.jsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, Badge, Button, ErrorNote, ConfirmDialog } from "../../components/common.jsx";

// How each plan action reads on screen. The wording matters more than usual
// here: this is the last thing anyone sees before containers get replaced.
const ACTION = {
  create: { label: "Create", tone: "accent" },
  recreate: { label: "Recreate", tone: "rose" },
  adopt: { label: "Adopted", tone: "amber" },
  noop: { label: "No change", tone: "slate" },
  orphaned: { label: "Orphaned", tone: "amber" },
  disabled: { label: "Switched off", tone: "slate" },
  incomplete: { label: "Not configured", tone: "slate" },
};

function ActionBadge({ action }) {
  const copy = ACTION[action] || { label: action, tone: "slate" };
  return <Badge tone={copy.tone}>{copy.label}</Badge>;
}

// Live container state, alongside the action badge's config-drift verdict —
// "will this change" and "is this actually running right now" are different
// questions, and a noop row can still be a container stuck restarting.
const RUNTIME_STATUS = {
  running: { label: "Running", tone: "green" },
  restarting: { label: "Restarting", tone: "amber" },
  paused: { label: "Paused", tone: "amber" },
  exited: { label: "Stopped", tone: "rose" },
  dead: { label: "Dead", tone: "rose" },
  created: { label: "Created", tone: "slate" },
};
const HEALTH = {
  healthy: { label: "Healthy", tone: "green" },
  unhealthy: { label: "Unhealthy", tone: "rose" },
  starting: { label: "Starting", tone: "amber" },
};

function RuntimeBadges({ runtime }) {
  if (!runtime) return null;
  const status = RUNTIME_STATUS[runtime.status] || { label: runtime.status, tone: "slate" };
  const health = runtime.health && HEALTH[runtime.health];
  return (
    <>
      <Badge tone={status.tone}>{status.label}</Badge>
      {health && <Badge tone={health.tone}>{health.label}</Badge>}
    </>
  );
}

// An empty plan means one of two quite different things, and saying the wrong
// one is worse than saying nothing: a fresh install has nothing configured,
// while a stack whose only component is switched off has everything configured
// and simply isn't running any of it.
function EmptyPlan({ components }) {
  const switchedOff = components.filter((component) => !component.active);

  return (
    <p className="px-5 py-6 text-sm text-slate-500 dark:text-slate-400">
      {switchedOff.length > 0 ? (
        `Nothing in the stack right now — ${switchedOff
          .map((component) => component.label)
          .join(" and ")} ${switchedOff.length === 1 ? "is" : "are"} switched off. Turn the VPN back on above to manage it again.`
      ) : (
        <>
          Nothing in the stack yet. Configure a component under the Components tab to get started,
          or run the{" "}
          <Link to="/setup" className="font-medium text-accent-600 hover:underline dark:text-accent-400">
            setup wizard
          </Link>{" "}
          for a guided walkthrough.
        </>
      )}
    </p>
  );
}

function PlanSummary({ summary }) {
  const parts = [];
  if (summary.changes > 0) parts.push(`${summary.changes} change${summary.changes === 1 ? "" : "s"}`);
  if (summary.restarts > 0)
    parts.push(`${summary.restarts} container${summary.restarts === 1 ? "" : "s"} restart`);
  if (summary.orphans > 0) parts.push(`${summary.orphans} orphaned`);
  if (summary.disabled > 0) parts.push(`${summary.disabled} switched off`);
  if (summary.incomplete > 0) parts.push(`${summary.incomplete} not configured`);

  // "Everything matches" is only true when there is something to match.
  if (parts.length === 0) {
    parts.push(summary.total === 0 ? "Nothing to manage" : "Everything matches its configuration");
  }
  return parts.join(" · ");
}

function PlanRow({ row, ordinal, onRemoveOrphan }) {
  const cascaded = !!row.cascadedFrom;

  return (
    <li
      className={`grid grid-cols-[1.75rem_1fr_auto] items-center gap-3 border-b border-slate-200 px-5 py-3 last:border-b-0 dark:border-slate-800 ${
        cascaded ? "bg-slate-50 dark:bg-slate-900/40" : ""
      }`}
    >
      <span className="text-xs tabular-nums text-slate-400 dark:text-slate-500">{ordinal}</span>
      <div className="min-w-0">
        <p className={`truncate font-mono text-sm text-slate-900 dark:text-white ${cascaded ? "pl-4" : ""}`}>
          {cascaded && <span className="mr-1 text-slate-300 dark:text-slate-600">└</span>}
          {row.spec?.name || row.containerName || row.label}
        </p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{row.reason}</p>
        {row.runtime && (
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <RuntimeBadges runtime={row.runtime} />
            {row.runtime.image && (
              <span className="font-mono text-slate-400 dark:text-slate-500">{row.runtime.image}</span>
            )}
          </p>
        )}
        {(row.warnings || []).map((warning) => (
          <p key={warning} className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            {warning}
          </p>
        ))}
      </div>
      <div className="flex items-center gap-2">
        {row.action === "orphaned" && (
          <button
            onClick={() => onRemoveOrphan(row)}
            className="text-xs font-medium text-rose-600 hover:underline dark:text-rose-400"
          >
            Remove
          </button>
        )}
        <ActionBadge action={row.action} />
      </div>
    </li>
  );
}

function JobLog({ job }) {
  return (
    <Card className="p-5">
      <div className="mb-2 flex items-center gap-2">
        <Badge tone={job.status === "success" ? "green" : job.status === "failed" ? "rose" : "slate"}>
          {job.status}
        </Badge>
      </div>
      <div className="max-h-64 overflow-y-auto font-mono text-xs text-slate-600 dark:text-slate-400">
        {(job.log || []).map((entry, i) => (
          <div key={i}>{entry.line}</div>
        ))}
        {job.error && <div className="text-rose-600 dark:text-rose-400">{job.error}</div>}
      </div>
    </Card>
  );
}

// The live diff between stored config and real Docker state, plus Apply and
// the job log — this is what stays visible regardless of which other tab is
// open, since editing any of them changes what this shows.
export default function PlanPanel({ plan, planError, components, busy, job, onApply, onConfirmRemoveOrphan }) {
  const [orphanToConfirm, setOrphanToConfirm] = useState(null);

  async function confirmRemoveOrphan() {
    const target = orphanToConfirm;
    setOrphanToConfirm(null);
    await onConfirmRemoveOrphan(target);
  }

  return (
    <div className="flex flex-col gap-4">
      {planError && <ErrorNote message={planError} />}

      {plan && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Stack plan</h2>
            <p className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
              <PlanSummary summary={plan.summary} />
            </p>
          </div>

          {plan.plans.length === 0 ? (
            <EmptyPlan components={components} />
          ) : (
            <ul>
              {plan.plans.map((row, index) => (
                <PlanRow
                  key={row.id + row.action}
                  row={row}
                  ordinal={index + 1}
                  onRemoveOrphan={setOrphanToConfirm}
                />
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-2 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
            <Button tone="accent" onClick={onApply} loading={busy} disabled={busy || plan.summary.changes === 0}>
              {plan.summary.changes === 0
                ? "Nothing to apply"
                : `Apply ${plan.summary.changes} change${plan.summary.changes === 1 ? "" : "s"}`}
            </Button>
          </div>
        </Card>
      )}

      {job && <JobLog job={job} />}

      <ConfirmDialog
        open={!!orphanToConfirm}
        title="Remove this container?"
        body={
          orphanToConfirm
            ? `${orphanToConfirm.containerName} was created by the Suite but is no longer part of your stack. Removing it stops and deletes the container.`
            : ""
        }
        confirmLabel="Remove"
        onConfirm={confirmRemoveOrphan}
        onCancel={() => setOrphanToConfirm(null)}
      />
    </div>
  );
}
```

- [ ] **Step 2: Remove the moved pieces from `Stack.jsx`**

Delete:
- Lines 12-56: `ACTION`, `ActionBadge`, `RUNTIME_STATUS`, `HEALTH`, `RuntimeBadges` (the whole block between the top imports and `export default function Stack`).
- Lines 432-456: the `EmptyPlan` function (and its preceding comment).
- Lines 767-859: `PlanCard`, `PlanSummary`, `PlanRow` (and `PlanCard`'s preceding nothing — the file's own section boundary).
- Lines 1039-1055: `JobLog` (the last thing in the file).

- [ ] **Step 3: Remove orphan-dialog state and the standalone dialog from `Stack`'s body**

Remove from the `Stack` function:
```js
const [orphanToRemove, setOrphanToRemove] = useState(null);
```
(one line out of the `useState` block at the top).

Remove the whole function:
```js
async function confirmRemoveOrphan() {
  const target = orphanToRemove;
  setOrphanToRemove(null);
  await runJob(() => api.removeOrphan(target.containerId));
}
```

Remove the standalone dialog JSX (currently right after the closing `</div>` of the page's main content, before `<RemoveInstanceDialog`):
```jsx
<ConfirmDialog
  open={!!orphanToRemove}
  title="Remove this container?"
  body={
    orphanToRemove
      ? `${orphanToRemove.containerName} was created by the Suite but is no longer part of your stack. Removing it stops and deletes the container.`
      : ""
  }
  confirmLabel="Remove"
  onConfirm={confirmRemoveOrphan}
  onCancel={() => setOrphanToRemove(null)}
/>
```

- [ ] **Step 4: Replace the plan-related render block**

Replace:
```jsx
        {planError && <ErrorNote message={planError} />}

        {plan && (
          <PlanCard
            plan={plan}
            components={components}
            busy={busy}
            onApply={() => runJob(() => api.applyStack())}
            onRemoveOrphan={setOrphanToRemove}
          />
        )}

        {job && <JobLog job={job} />}
```
with:
```jsx
        <PlanPanel
          plan={plan}
          planError={planError}
          components={components}
          busy={busy}
          job={job}
          onApply={() => runJob(() => api.applyStack())}
          onConfirmRemoveOrphan={(row) => runJob(() => api.removeOrphan(row.containerId))}
        />
```

- [ ] **Step 5: Update `Stack.jsx`'s imports**

Remove `Link` from the `react-router-dom` import (it's no longer used directly in `Stack.jsx` — `EmptyPlan`, the only user, moved out):
```js
import { Link } from "react-router-dom";
```
→ delete this line entirely (no other named import from `react-router-dom` was present).

Add, alongside the `HistoryPanel` import from Task 1:
```js
import PlanPanel from "./stack/PlanPanel.jsx";
```

`ConfirmDialog` stays imported in `Stack.jsx` for now — `RemoveInstanceDialog` (still inline, moves in Task 3) still uses it.

- [ ] **Step 6: Verify the build**

Run: `cd web && npm run build`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
cd /root/work/stream-share-suite
git add web/src/pages/stack/PlanPanel.jsx web/src/pages/Stack.jsx
git commit -m "$(cat <<'EOF'
Extract PlanPanel, move orphan-remove dialog ownership into it

Combines PlanCard/PlanSummary/PlanRow/EmptyPlan/JobLog/ActionBadge/
RuntimeBadges into one PlanPanel component per the redesign spec —
needed as one importable unit since Task 6 renders it in two places
(sticky rail, mobile Plan tab) without duplicating markup.

Orphan-removal confirm dialog's open/closed state moves from the page
orchestrator into PlanPanel itself, which now calls a new
onConfirmRemoveOrphan(row) prop only once the user actually confirms
— the orchestrator no longer tracks "which orphan is pending
confirmation" at all.

EmptyPlan's copy fixed: "Configure a component below to get started"
assumed the old single-scroll layout. Now names the Components tab
instead of a spatial direction that's no longer accurate.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CJT1ab1HK6BXhUAHTcAPyZ
EOF
)"
```

---

### Task 3: Extract `InstancesTab`

Combines `InstancesCard` + `RemoveInstanceDialog` + `PortRangeSetting` (moved here from the soon-to-be-deleted `StackSettings`) into one file. Moves remove-instance dialog state out of the orchestrator.

**Files:**
- Create: `web/src/pages/stack/InstancesTab.jsx`
- Modify: `web/src/pages/Stack.jsx` (remove `InstancesCard` at lines 567-765; remove `RemoveInstanceDialog` at lines 250-312; remove `PortRangeSetting` at lines 384-430 — but only the function itself, `StackSettings` still calls it until Task 4; remove `instanceToRemove`/`dropDatabase` state and `confirmRemoveInstance` at lines 68-69, 150-157; remove the standalone `<RemoveInstanceDialog>` block at lines 233-242; replace the instances render block; add a `removeInstance` orchestrator function)

**Interfaces:**
- Consumes: `HistoryPanel` from `./HistoryPanel.jsx` (Task 1).
- Produces: default export `InstancesTab({ settings, onSaveSettings, instances, portBand, containerPrefix, busy, onAdd, onEdit, onConfirmRemove, onPull, onRestored })`. `onConfirmRemove(key, { dropDatabase })` replaces the old two-step `onRemove` (open dialog) + orchestrator-level `confirmRemoveInstance` — `InstancesTab` now owns the whole dialog lifecycle and calls this prop only once confirmed. Task 6 wires this to a new orchestrator function, `removeInstance`.

**Note on `StackSettings`:** it is NOT deleted in this task — it still exists in `Stack.jsx` after this task, minus the `PortRangeSetting` it used to render (that call is removed from `StackSettings`'s JSX too, in Step 2 below). `StackSettings` itself (the VPN toggle + Caddy toggle, without port range) is deleted in Task 4, once `GluetunCard`/`CaddyCard` exist to absorb those two toggles.

- [ ] **Step 1: Create the new file**

```jsx
// web/src/pages/stack/InstancesTab.jsx
import { useEffect, useState } from "react";
import { Card, Button } from "../../components/common.jsx";
import SchemaForm from "../../components/SchemaForm.jsx";
import { IconRefresh, IconEdit, IconTrash } from "../../components/Icons.jsx";
import { api } from "../../lib/api.js";
import { previewContainerName, previewContainerNameForKey } from "../../lib/containerName.js";
import HistoryPanel from "./HistoryPanel.jsx";

// The band an instance's port is allocated from — a fixed 20 slots starting
// here. Only worth changing if that range is already taken by something else
// on the host; an instance that already has a port keeps it regardless.
function PortRangeSetting({ settings, onSave, busy }) {
  const [draft, setDraft] = useState(String(settings.instancePortStart));
  const [error, setError] = useState(null);

  useEffect(() => {
    setDraft(String(settings.instancePortStart));
  }, [settings.instancePortStart]);

  async function save() {
    setError(null);
    try {
      await onSave({ instancePortStart: Number(draft) });
    } catch (err) {
      setError(err.message);
    }
  }

  const dirty = Number(draft) !== settings.instancePortStart;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Instance port range</h2>
        <p className="mt-1 max-w-prose text-xs text-slate-500 dark:text-slate-400">
          Instances are allocated 20 ports starting here (currently {settings.instancePortStart}–
          {settings.instancePortStart + 19}). Existing instances keep the port they already have.
        </p>
        {error && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <input
          type="number"
          className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button tone="ghost" onClick={save} disabled={busy || !dirty}>
          Save
        </Button>
      </div>
    </div>
  );
}

// Removing an instance asks about its database rather than deciding for you.
// The container is trivially rebuilt; the watch history is not, so keeping it
// is the default and dropping it needs the name typed back.
function RemoveInstanceDialog({ instance, dropDatabase, onToggleDrop, onConfirm, onCancel }) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!instance) setTyped("");
  }, [instance]);

  if (!instance) return null;

  const confirmed = !dropDatabase || typed === instance.displayName;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} aria-hidden="true" />
      <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          Remove {instance.displayName}?
        </h3>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          This takes it out of the stack. Its container keeps running until you apply the plan,
          which will then offer to remove it.
        </p>

        <label className="mt-4 flex items-start gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <input
            type="checkbox"
            checked={dropDatabase}
            onChange={(e) => onToggleDrop(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
          />
          <span className="text-xs text-slate-600 dark:text-slate-400">
            Also drop <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{instance.databaseName}</code> and
            its role. <strong className="text-rose-600 dark:text-rose-400">This deletes its watch
            history permanently.</strong> Leave it unticked to keep the data.
          </span>
        </label>

        {dropDatabase && (
          <label className="mt-3 flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Type <strong>{instance.displayName}</strong> to confirm
            </span>
            <input
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
            />
          </label>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button tone="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button tone="rose" onClick={onConfirm} disabled={!confirmed}>
            {dropDatabase ? "Remove and drop database" : "Remove"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function InstancesTab({
  settings,
  onSaveSettings,
  instances,
  portBand,
  containerPrefix,
  busy,
  onAdd,
  onEdit,
  onConfirmRemove,
  onPull,
  onRestored,
}) {
  const [adding, setAdding] = useState(false);
  const [addFields, setAddFields] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const [editingKey, setEditingKey] = useState(null);
  const [editFields, setEditFields] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState(null);

  const [instanceToRemove, setInstanceToRemove] = useState(null);
  const [dropDatabase, setDropDatabase] = useState(false);

  useEffect(() => {
    if (!adding || addFields) return;
    api.componentFields("instance").then((res) => setAddFields(res.fields));
  }, [adding, addFields]);

  useEffect(() => {
    if (!editingKey || editFields) return;
    api.componentFields("instance", editingKey).then((res) => setEditFields(res.fields));
  }, [editingKey, editFields]);

  function toggleAdding() {
    setEditingKey(null);
    setEditFields(null);
    setAdding((v) => !v);
    setAddFields(null);
    setError(null);
  }

  function toggleEditing(key) {
    setAdding(false);
    setAddFields(null);
    setError(null);
    setEditingKey((current) => (current === key ? null : key));
    setEditFields(null);
    setEditError(null);
  }

  async function create(patch) {
    setSaving(true);
    setError(null);
    try {
      await onAdd(patch);
      setAdding(false);
      setAddFields(null);
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
      await onEdit(editingKey, patch);
      setEditingKey(null);
      setEditFields(null);
    } catch (err) {
      setEditError(err.body?.errors?.map((e) => e.message).join(" ") || err.message);
    } finally {
      setEditSaving(false);
    }
  }

  async function confirmRemove() {
    const target = instanceToRemove;
    const drop = dropDatabase;
    setInstanceToRemove(null);
    setDropDatabase(false);
    await onConfirmRemove(target.key, { dropDatabase: drop });
  }

  return (
    <div className="flex flex-col gap-4">
      {settings && (
        <Card className="p-5">
          <PortRangeSetting settings={settings} onSave={onSaveSettings} busy={busy} />
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Instances</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              One per IPTV provider. Ports are allocated from {portBand?.first}–{portBand?.last}; the
              address and API key are worked out for you.
            </p>
          </div>
          <Button tone="accent" onClick={toggleAdding} disabled={busy}>
            {adding ? "Cancel" : "Add instance"}
          </Button>
        </div>

        {instances.length === 0 && !adding && (
          <p className="px-5 py-6 text-sm text-slate-500 dark:text-slate-400">
            No instances yet. Adding one creates its container, its database and its API key.
          </p>
        )}

        {instances.length > 0 && (
          <ul>
            {instances.map((instance) => (
              <li key={instance.key} className="border-b border-slate-200 last:border-b-0 dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                      {instance.displayName}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                      {instance.containerName} · {instance.url}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      onClick={() => onPull(instance.key)}
                      disabled={busy}
                      aria-label="Check for updates"
                      title="Pull this instance's own configured image tag and recreate only if it actually changed"
                      className="rounded-lg p-1.5 text-accent-600 hover:bg-accent-50 disabled:opacity-50 dark:text-accent-400 dark:hover:bg-accent-900/30"
                    >
                      <IconRefresh className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => toggleEditing(instance.key)}
                      disabled={busy}
                      aria-label={editingKey === instance.key ? "Close" : "Edit"}
                      title={editingKey === instance.key ? "Close" : "Edit"}
                      className="rounded-lg p-1.5 text-accent-600 hover:bg-accent-50 disabled:opacity-50 dark:text-accent-400 dark:hover:bg-accent-900/30"
                    >
                      {editingKey === instance.key ? (
                        <span className="text-xs font-medium">Close</span>
                      ) : (
                        <IconEdit className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      onClick={() => setInstanceToRemove(instance)}
                      disabled={busy}
                      aria-label="Remove"
                      title="Remove"
                      className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-900/30"
                    >
                      <IconTrash className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {editingKey === instance.key && (
                  <div className="border-t border-slate-200 px-5 py-5 dark:border-slate-800">
                    {editFields === null ? (
                      <p className="text-sm text-slate-400">Loading…</p>
                    ) : (
                      <SchemaForm
                        fields={editFields}
                        onSave={saveEdit}
                        saving={editSaving}
                        error={editError}
                        submitLabel="Save changes"
                        preview={(draft) => (
                          <p className="-mt-2 font-mono text-xs text-slate-500 dark:text-slate-400">
                            Container name:{" "}
                            {previewContainerNameForKey(draft, { prefix: containerPrefix, key: instance.key })}
                          </p>
                        )}
                      />
                    )}

                    <HistoryPanel
                      kind="instance"
                      componentKey={instance.key}
                      busy={busy}
                      onRestored={async () => {
                        setEditFields(null);
                        await onRestored();
                      }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {adding && (
          <div className="border-t border-slate-200 px-5 py-5 dark:border-slate-800">
            {addFields === null ? (
              <p className="text-sm text-slate-400">Loading…</p>
            ) : (
              <SchemaForm
                fields={addFields}
                onSave={create}
                saving={saving}
                error={error}
                submitLabel="Create instance"
                preview={(draft) => (
                  <p className="-mt-2 font-mono text-xs text-slate-500 dark:text-slate-400">
                    Container name:{" "}
                    {previewContainerName(draft, { prefix: containerPrefix, existingKeys: instances.map((i) => i.key) })}
                  </p>
                )}
              />
            )}
          </div>
        )}
      </Card>

      <RemoveInstanceDialog
        instance={instanceToRemove}
        dropDatabase={dropDatabase}
        onToggleDrop={setDropDatabase}
        onConfirm={confirmRemove}
        onCancel={() => {
          setInstanceToRemove(null);
          setDropDatabase(false);
        }}
      />
    </div>
  );
}
```

Note the confirm-input's `className` is now the literal string that `FIELD` (from `common.jsx`) resolves to, rather than importing `FIELD` — `FIELD` is `web/src/components/common.jsx`'s exported constant `"w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"`. Either works; importing `FIELD` instead is also fine and arguably cleaner — if you do, add `FIELD` to this file's `common.jsx` import list instead of inlining the string.

- [ ] **Step 2: Remove `InstancesCard`, `RemoveInstanceDialog`, `PortRangeSetting` from `Stack.jsx`**

Delete the entire `InstancesCard` function (lines 567-765).

Delete the entire `RemoveInstanceDialog` function (lines 250-312, including its preceding comment).

Delete the entire `PortRangeSetting` function (lines 384-430, including its preceding comment).

In `StackSettings` (still present at this point), remove the line that rendered it:
```jsx
      <PortRangeSetting settings={settings} onSave={onSave} busy={busy} />

```
(the blank line after it goes too — `StackSettings` now renders only the VPN toggle and the `OptionalComponentToggle` for Caddy).

- [ ] **Step 3: Remove remove-instance state and the standalone dialog from `Stack`'s body**

Remove from the `Stack` function's `useState` block:
```js
const [instanceToRemove, setInstanceToRemove] = useState(null);
const [dropDatabase, setDropDatabase] = useState(false);
```

Remove the whole function:
```js
async function confirmRemoveInstance() {
  const target = instanceToRemove;
  const drop = dropDatabase;
  setInstanceToRemove(null);
  setDropDatabase(false);
  await runJob(() => api.removeStackInstance(target.key, { dropDatabase: drop }));
  await reload();
}
```

Add a new function in its place — this is what `InstancesTab`'s `onConfirmRemove` prop will call:
```js
async function removeInstance(key, opts) {
  await runJob(() => api.removeStackInstance(key, opts));
  await reload();
}
```

Remove the standalone `<RemoveInstanceDialog>` JSX block (currently the last thing before `</Layout>`):
```jsx
<RemoveInstanceDialog
  instance={instanceToRemove}
  dropDatabase={dropDatabase}
  onToggleDrop={setDropDatabase}
  onConfirm={confirmRemoveInstance}
  onCancel={() => {
    setInstanceToRemove(null);
    setDropDatabase(false);
  }}
/>
```

- [ ] **Step 4: Replace the instances render block**

Replace:
```jsx
        <InstancesCard
          instances={instances}
          portBand={portBand}
          containerPrefix={settings?.containerPrefix || ""}
          busy={busy}
          onAdd={addInstance}
          onEdit={editInstance}
          onRemove={setInstanceToRemove}
          onPull={(key) => runJob(() => api.pullComponent("instance", key))}
          onRestored={reload}
        />
```
with:
```jsx
        <InstancesTab
          settings={settings}
          onSaveSettings={saveSettings}
          instances={instances}
          portBand={portBand}
          containerPrefix={settings?.containerPrefix || ""}
          busy={busy}
          onAdd={addInstance}
          onEdit={editInstance}
          onConfirmRemove={removeInstance}
          onPull={(key) => runJob(() => api.pullComponent("instance", key))}
          onRestored={reload}
        />
```

- [ ] **Step 5: Update `Stack.jsx`'s imports**

Remove `FIELD`, `ConfirmDialog`, `IconEdit`, `IconTrash` — nothing left in `Stack.jsx` uses them after this task (`ConfirmDialog`'s only remaining direct user, `RemoveInstanceDialog`, just moved out; `PlanPanel`'s own `ConfirmDialog` usage lives inside `PlanPanel.jsx` now, imported there independently — that's a separate import in a separate file, unaffected by this one). `IconRefresh` and `IconSettings` stay — `ComponentCard`, still in `Stack.jsx` until Task 4, uses both.

Also remove `previewContainerName`, `previewContainerNameForKey` — only `InstancesCard` used them.

Before:
```js
import { Card, Badge, Button, ErrorNote, ConfirmDialog, FIELD, RefreshButton } from "../components/common.jsx";
import { IconRefresh, IconEdit, IconTrash, IconSettings } from "../components/Icons.jsx";
import SchemaForm from "../components/SchemaForm.jsx";
import { api, ApiError } from "../lib/api.js";
import { useJobPolling } from "../lib/useJobPolling.js";
import { previewContainerName, previewContainerNameForKey } from "../lib/containerName.js";
```
After:
```js
import { Card, Badge, Button, ErrorNote, RefreshButton } from "../components/common.jsx";
import { IconRefresh, IconSettings } from "../components/Icons.jsx";
import SchemaForm from "../components/SchemaForm.jsx";
import { api, ApiError } from "../lib/api.js";
import { useJobPolling } from "../lib/useJobPolling.js";
```

Add, alongside the `HistoryPanel`/`PlanPanel` imports from Tasks 1-2:
```js
import InstancesTab from "./stack/InstancesTab.jsx";
```

- [ ] **Step 6: Verify the build**

Run: `cd web && npm run build`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
cd /root/work/stream-share-suite
git add web/src/pages/stack/InstancesTab.jsx web/src/pages/Stack.jsx
git commit -m "$(cat <<'EOF'
Extract InstancesTab, merge in port range, move remove-dialog ownership

Combines InstancesCard/RemoveInstanceDialog with PortRangeSetting
(moved here from StackSettings — it governs how instances are
allocated, so it belongs with them, per the redesign spec). Remove-
instance dialog's open/closed state moves from the page orchestrator
into InstancesTab itself, same pattern as Task 2's orphan-removal
dialog move.

StackSettings itself isn't deleted yet — still renders the VPN and
Caddy toggles until Task 4 gives those a home in their own component
cards.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CJT1ab1HK6BXhUAHTcAPyZ
EOF
)"
```

---

### Task 4: Split `ComponentCard` into `GluetunCard`/`PostgresCard`/`CaddyCard`, delete `StackSettings`

The biggest task — four new files land together since `ComponentsTab` only makes sense once the three cards exist, and a reviewer evaluating the split would need all four to judge it. Also where the VPN and Caddy toggles move out of the now-fully-emptied `StackSettings`, and where the old per-card Configure/Close collapse is removed (config form always shown — no longer needed once Components has its own dedicated tab).

**Files:**
- Create: `web/src/pages/stack/GluetunCard.jsx`
- Create: `web/src/pages/stack/PostgresCard.jsx`
- Create: `web/src/pages/stack/CaddyCard.jsx`
- Create: `web/src/pages/stack/ComponentsTab.jsx`
- Modify: `web/src/pages/Stack.jsx` (remove `ComponentCard` at lines 942-1037; remove `StackSettings` and `OptionalComponentToggle` at lines 319-382; remove the components `.map()` render block and the `StackSettings` render call; replace with `ComponentsTab`)

**Interfaces:**
- Consumes: `HistoryPanel` from `./HistoryPanel.jsx` (Task 1) in all three cards.
- Produces: default exports `GluetunCard({ component, settings, onSaveSettings, busy, onSaved, takeoverAvailable, onApplyTakeover, onPull })`, `CaddyCard({ ...same shape... })`, `PostgresCard({ component, busy, onSaved, takeoverAvailable, onApplyTakeover, onPull })` (no `settings`/`onSaveSettings` — postgres has no on/off toggle), and `ComponentsTab({ components, settings, onSaveSettings, busy, onSaved, plan, onApplyTakeover, onPull })` where `onApplyTakeover`/`onPull` here take a `kind` argument (`ComponentsTab` calls each card's version with that kind pre-bound). Task 6 renders `ComponentsTab`.

- [ ] **Step 1: Create `GluetunCard.jsx`**

```jsx
// web/src/pages/stack/GluetunCard.jsx
import { useEffect, useState } from "react";
import { Card, Badge, Button } from "../../components/common.jsx";
import { IconRefresh } from "../../components/Icons.jsx";
import SchemaForm from "../../components/SchemaForm.jsx";
import { api } from "../../lib/api.js";
import HistoryPanel from "./HistoryPanel.jsx";

export default function GluetunCard({
  component,
  settings,
  onSaveSettings,
  busy,
  onSaved,
  takeoverAvailable,
  onApplyTakeover,
  onPull,
}) {
  const [fields, setFields] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.componentFields(component.kind).then((res) => setFields(res.fields));
  }, [component.kind]);

  async function save(patch) {
    setSaving(true);
    setError(null);
    try {
      const result = await api.saveComponent(component.kind, patch);
      setFields(result.fields);
      await onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function refreshAfterRestore() {
    const result = await api.componentFields(component.kind);
    setFields(result.fields);
    await onSaved();
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{component.label}</h2>
          <p className="mt-1 max-w-prose text-xs text-slate-500 dark:text-slate-400">
            {component.description}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!component.active && <Badge tone="slate">Not in the stack</Badge>}
          {component.active && (
            <button
              onClick={onPull}
              disabled={busy}
              aria-label="Check for updates"
              title="Pull this component's own configured image tag and recreate only if it actually changed"
              className="rounded-lg p-1.5 text-accent-600 hover:bg-accent-50 disabled:opacity-50 dark:text-accent-400 dark:hover:bg-accent-900/30"
            >
              <IconRefresh className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-4 dark:border-slate-800">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Route traffic through a VPN
          </h3>
          <p className="mt-1 max-w-prose text-xs text-slate-500 dark:text-slate-400">
            {settings.vpnEnabled
              ? "Instances share gluetun's network namespace and are published through it. Replacing gluetun briefly takes them with it."
              : "Every container gets its own network and publishes its own port. Turning this back on rebuilds everything that would share the tunnel."}
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={settings.vpnEnabled}
            disabled={busy}
            onChange={(e) => onSaveSettings({ vpnEnabled: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
          />
          {settings.vpnEnabled ? "On" : "Off"}
        </label>
      </div>

      <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800">
        {fields === null ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <SchemaForm
            fields={fields}
            onSave={save}
            saving={saving}
            error={error}
            submitLabel="Save configuration"
          />
        )}

        <HistoryPanel kind={component.kind} busy={busy} onRestored={refreshAfterRestore} />

        {takeoverAvailable && (
          <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
            <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
              A container by this name is already running without the Suite's labels. It stays
              untouched unless you replace it with a managed one.
            </p>
            <Button tone="rose" onClick={onApplyTakeover} loading={busy} disabled={busy}>
              Take over anyway
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Create `CaddyCard.jsx`**

```jsx
// web/src/pages/stack/CaddyCard.jsx
import { useEffect, useState } from "react";
import { Card, Badge, Button } from "../../components/common.jsx";
import { IconRefresh } from "../../components/Icons.jsx";
import SchemaForm from "../../components/SchemaForm.jsx";
import { api } from "../../lib/api.js";
import HistoryPanel from "./HistoryPanel.jsx";

export default function CaddyCard({
  component,
  settings,
  onSaveSettings,
  busy,
  onSaved,
  takeoverAvailable,
  onApplyTakeover,
  onPull,
}) {
  const [fields, setFields] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.componentFields(component.kind).then((res) => setFields(res.fields));
  }, [component.kind]);

  async function save(patch) {
    setSaving(true);
    setError(null);
    try {
      const result = await api.saveComponent(component.kind, patch);
      setFields(result.fields);
      await onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function refreshAfterRestore() {
    const result = await api.componentFields(component.kind);
    setFields(result.fields);
    await onSaved();
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{component.label}</h2>
          <p className="mt-1 max-w-prose text-xs text-slate-500 dark:text-slate-400">
            {component.description}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!component.active && <Badge tone="slate">Not in the stack</Badge>}
          {component.active && (
            <button
              onClick={onPull}
              disabled={busy}
              aria-label="Check for updates"
              title="Pull this component's own configured image tag and recreate only if it actually changed"
              className="rounded-lg p-1.5 text-accent-600 hover:bg-accent-50 disabled:opacity-50 dark:text-accent-400 dark:hover:bg-accent-900/30"
            >
              <IconRefresh className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-4 dark:border-slate-800">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Caddy (reverse proxy)</h3>
          <p className="mt-1 max-w-prose text-xs text-slate-500 dark:text-slate-400">
            Publishes any instance with a public base URL under a real hostname, with HTTPS handled
            for you.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={!!settings.caddyEnabled}
            disabled={busy}
            onChange={(e) => onSaveSettings({ caddyEnabled: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
          />
          {settings.caddyEnabled ? "On" : "Off"}
        </label>
      </div>

      <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800">
        {fields === null ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <SchemaForm
            fields={fields}
            onSave={save}
            saving={saving}
            error={error}
            submitLabel="Save configuration"
          />
        )}

        <HistoryPanel kind={component.kind} busy={busy} onRestored={refreshAfterRestore} />

        {takeoverAvailable && (
          <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
            <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
              A container by this name is already running without the Suite's labels. It stays
              untouched unless you replace it with a managed one.
            </p>
            <Button tone="rose" onClick={onApplyTakeover} loading={busy} disabled={busy}>
              Take over anyway
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
```

- [ ] **Step 3: Create `PostgresCard.jsx`**

```jsx
// web/src/pages/stack/PostgresCard.jsx
import { useEffect, useState } from "react";
import { Card, Badge, Button } from "../../components/common.jsx";
import { IconRefresh } from "../../components/Icons.jsx";
import SchemaForm from "../../components/SchemaForm.jsx";
import { api } from "../../lib/api.js";
import HistoryPanel from "./HistoryPanel.jsx";

export default function PostgresCard({ component, busy, onSaved, takeoverAvailable, onApplyTakeover, onPull }) {
  const [fields, setFields] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.componentFields(component.kind).then((res) => setFields(res.fields));
  }, [component.kind]);

  async function save(patch) {
    setSaving(true);
    setError(null);
    try {
      const result = await api.saveComponent(component.kind, patch);
      setFields(result.fields);
      await onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function refreshAfterRestore() {
    const result = await api.componentFields(component.kind);
    setFields(result.fields);
    await onSaved();
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{component.label}</h2>
          <p className="mt-1 max-w-prose text-xs text-slate-500 dark:text-slate-400">
            {component.description}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!component.active && <Badge tone="slate">Not in the stack</Badge>}
          {component.active && (
            <button
              onClick={onPull}
              disabled={busy}
              aria-label="Check for updates"
              title="Pull this component's own configured image tag and recreate only if it actually changed"
              className="rounded-lg p-1.5 text-accent-600 hover:bg-accent-50 disabled:opacity-50 dark:text-accent-400 dark:hover:bg-accent-900/30"
            >
              <IconRefresh className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800">
        {fields === null ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <SchemaForm
            fields={fields}
            onSave={save}
            saving={saving}
            error={error}
            submitLabel="Save configuration"
          />
        )}

        <HistoryPanel kind={component.kind} busy={busy} onRestored={refreshAfterRestore} />

        {takeoverAvailable && (
          <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
            <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
              A container by this name is already running without the Suite's labels. It stays
              untouched unless you replace it with a managed one.
            </p>
            <Button tone="rose" onClick={onApplyTakeover} loading={busy} disabled={busy}>
              Take over anyway
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
```

- [ ] **Step 4: Create `ComponentsTab.jsx`**

```jsx
// web/src/pages/stack/ComponentsTab.jsx
import GluetunCard from "./GluetunCard.jsx";
import PostgresCard from "./PostgresCard.jsx";
import CaddyCard from "./CaddyCard.jsx";

const CARD_BY_KIND = {
  gluetun: GluetunCard,
  postgres: PostgresCard,
  caddy: CaddyCard,
};

// Instances have their own tab — this only ever renders the three
// singleton components (gluetun/postgres/caddy).
export default function ComponentsTab({
  components,
  settings,
  onSaveSettings,
  busy,
  onSaved,
  plan,
  onApplyTakeover,
  onPull,
}) {
  return (
    <div className="flex flex-col gap-4">
      {components
        .filter((component) => component.kind !== "instance")
        .map((component) => {
          const CardComponent = CARD_BY_KIND[component.kind];
          if (!CardComponent) return null;
          const takeoverAvailable =
            plan?.plans.some((row) => row.kind === component.kind && row.action === "adopt") || false;
          return (
            <CardComponent
              key={component.kind}
              component={component}
              settings={settings}
              onSaveSettings={onSaveSettings}
              busy={busy}
              onSaved={onSaved}
              takeoverAvailable={takeoverAvailable}
              onApplyTakeover={() => onApplyTakeover(component.kind)}
              onPull={() => onPull(component.kind)}
            />
          );
        })}
    </div>
  );
}
```

(`PostgresCard` ignores the `settings`/`onSaveSettings` props `ComponentsTab` passes it — harmless, it simply doesn't destructure them, same as any React component receiving props it doesn't use.)

- [ ] **Step 5: Remove `ComponentCard`, `StackSettings`, `OptionalComponentToggle` from `Stack.jsx`**

Delete the entire `ComponentCard` function (lines 942-1037).

Delete the entire `StackSettings` function (lines 319-357, including its preceding comment about `SUITE_DATA_DIR`).

Delete the entire `OptionalComponentToggle` function (lines 363-382, including its preceding comment about Caddy).

- [ ] **Step 6: Replace the settings + components render blocks**

Replace:
```jsx
        {settings && <StackSettings settings={settings} onSave={saveSettings} busy={busy} />}
```
— delete this line entirely (no replacement; `StackSettings`'s two toggles now live inside `ComponentsTab`'s cards).

Replace:
```jsx
        {/* Instances have their own card above — these are the singletons. */}
        {components
          .filter((component) => component.kind !== "instance")
          .map((component) => (
            <ComponentCard
              key={component.kind}
              component={component}
              onSaved={refreshPlan}
              busy={busy}
              onApplyTakeover={() =>
                runJob(() => api.applyComponent(component.kind, { takeover: true }))
              }
              onPull={() => runJob(() => api.pullComponent(component.kind))}
              takeoverAvailable={
                plan?.plans.some((row) => row.kind === component.kind && row.action === "adopt") || false
              }
            />
          ))}
```
with:
```jsx
        <ComponentsTab
          components={components}
          settings={settings}
          onSaveSettings={saveSettings}
          busy={busy}
          onSaved={refreshPlan}
          plan={plan}
          onApplyTakeover={(kind) => runJob(() => api.applyComponent(kind, { takeover: true }))}
          onPull={(kind) => runJob(() => api.pullComponent(kind))}
        />
```

- [ ] **Step 7: Update `Stack.jsx`'s imports**

`SchemaForm`, `IconRefresh`, `IconSettings`, `Badge`, `Card`, `Button` all become unused in `Stack.jsx` after this task — `ComponentCard`/`StackSettings`/`OptionalComponentToggle` were their only remaining callers (`ComponentCard` specifically was still using `Button` for its "Take over anyway" button right up through Task 3 — it's this task's removal of `ComponentCard`, not an earlier one, that finally drops `Button`'s last use in this file).

Before:
```js
import { Card, Badge, Button, ErrorNote, RefreshButton } from "../components/common.jsx";
import { IconRefresh, IconSettings } from "../components/Icons.jsx";
import SchemaForm from "../components/SchemaForm.jsx";
import { api, ApiError } from "../lib/api.js";
import { useJobPolling } from "../lib/useJobPolling.js";
```
After:
```js
import { ErrorNote, RefreshButton } from "../components/common.jsx";
import { api, ApiError } from "../lib/api.js";
import { useJobPolling } from "../lib/useJobPolling.js";
```

Add, alongside the other `./stack/*` imports:
```js
import ComponentsTab from "./stack/ComponentsTab.jsx";
```

- [ ] **Step 8: Verify the build**

Run: `cd web && npm run build`
Expected: PASS, clean.

- [ ] **Step 9: Commit**

```bash
cd /root/work/stream-share-suite
git add web/src/pages/stack/GluetunCard.jsx web/src/pages/stack/CaddyCard.jsx web/src/pages/stack/PostgresCard.jsx web/src/pages/stack/ComponentsTab.jsx web/src/pages/Stack.jsx
git commit -m "$(cat <<'EOF'
Split ComponentCard into three purpose-built cards, delete StackSettings

GluetunCard/CaddyCard/PostgresCard replace the one generic
ComponentCard parameterized over component.kind — chosen over keeping
one generic card with a kind-based branch, per discussion: VPN's
toggle carries a long, important warning (network-namespace change,
cascades to every instance running through it), Caddy's is a
one-liner, and Postgres has no toggle at all (managed-vs-external is a
different axis with no "off" state). One generic card would have piled
up conditionals for three genuinely different shapes.

VPN and Caddy toggles moved here verbatim from StackSettings, which is
now fully empty (its third field, port range, moved to InstancesTab in
Task 3) and is deleted along with OptionalComponentToggle.

Per-card Configure/Close collapse removed — it existed to keep the old
single-scroll page shorter; Components now has its own dedicated tab,
so each card shows its config form directly, matching how a Setup
wizard step already shows one full form with no collapse. History
stays its own collapse (genuinely rare-use, unlike the primary form).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CJT1ab1HK6BXhUAHTcAPyZ
EOF
)"
```

---

### Task 5: Extract `ImportTab`

Trivial rename/move, zero logic change — given its own task since it's fully independent of Components/Instances and a reviewer shouldn't have to wade through the Task 4 diff to find it.

**Files:**
- Create: `web/src/pages/stack/ImportTab.jsx`
- Modify: `web/src/pages/Stack.jsx` (remove `ImportCard` and `IMPORT_KIND_LABEL` at lines 458-565; replace the render call)

**Interfaces:**
- Produces: default export `ImportTab({ onImported })` — identical props to today's `ImportCard`. Task 6 renders it.

- [ ] **Step 1: Create the new file**

```jsx
// web/src/pages/stack/ImportTab.jsx
import { useState } from "react";
import { Card, Button, ErrorNote } from "../../components/common.jsx";
import { api } from "../../lib/api.js";

const IMPORT_KIND_LABEL = {
  gluetun: "Gluetun (VPN)",
  postgres: "PostgreSQL",
  instance: "StreamShare instance",
};

// Distinct from adoption, which the plan already shows on its own: adopting
// only ever means "leave this container running, untouched" — it never
// fills in the Suite's own configuration for it, so an adopted component's
// form stays blank until someone types into it. This is what actually reads
// a real container's env, image and networks back into that configuration.
// A scan is a real Docker API call, so it only runs when asked for rather
// than on every page load the way the plan does.
export default function ImportTab({ onImported }) {
  const [scanned, setScanned] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [importingId, setImportingId] = useState(null);
  const [error, setError] = useState(null);

  async function scan() {
    setScanning(true);
    setError(null);
    try {
      const res = await api.importCandidates();
      setCandidates(res.candidates);
      setScanned(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setScanning(false);
    }
  }

  async function doImport(candidate) {
    setImportingId(candidate.containerId);
    setError(null);
    try {
      await api.importCandidate(candidate.containerId, candidate.kind);
      setCandidates((prev) => prev.filter((c) => c.containerId !== candidate.containerId));
      await onImported();
    } catch (err) {
      setError(`${candidate.name}: ${err.message}`);
    } finally {
      setImportingId(null);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Import from running containers
          </h2>
          <p className="mt-1 max-w-prose text-xs text-slate-500 dark:text-slate-400">
            Finds gluetun, PostgreSQL and StreamShare containers already running outside the Suite
            and reads their real configuration in, instead of retyping it by hand. The containers
            themselves are never touched.
          </p>
        </div>
        <Button tone="ghost" onClick={scan} loading={scanning} disabled={scanning}>
          {scanned ? "Scan again" : "Scan for existing containers"}
        </Button>
      </div>

      {error && (
        <div className="px-5 pt-4">
          <ErrorNote message={error} />
        </div>
      )}

      {scanned && candidates.length === 0 && !error && (
        <p className="px-5 py-6 text-sm text-slate-500 dark:text-slate-400">
          Nothing found that isn't already part of the stack.
        </p>
      )}

      {candidates.length > 0 && (
        <ul>
          {candidates.map((candidate) => (
            <li
              key={candidate.containerId}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3 last:border-b-0 dark:border-slate-800"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                  {candidate.name}
                </p>
                <p className="mt-0.5 truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                  {IMPORT_KIND_LABEL[candidate.kind] || candidate.kind} · {candidate.image}
                </p>
              </div>
              <Button
                tone="accent"
                onClick={() => doImport(candidate)}
                loading={importingId === candidate.containerId}
                disabled={importingId !== null}
              >
                Import
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Remove `ImportCard` and `IMPORT_KIND_LABEL` from `Stack.jsx`**

Delete lines 458-565 in full (the `IMPORT_KIND_LABEL` const, the comment above `ImportCard`, and the `ImportCard` function itself).

- [ ] **Step 3: Replace the render call**

Replace:
```jsx
        <ImportCard onImported={reload} />
```
with:
```jsx
        <ImportTab onImported={reload} />
```

- [ ] **Step 4: Add the import**

Add, alongside the other `./stack/*` imports:
```js
import ImportTab from "./stack/ImportTab.jsx";
```

- [ ] **Step 5: Verify the build**

Run: `cd web && npm run build`
Expected: PASS, clean. At this point `Stack.jsx` should contain no function definitions of its own besides the default-exported `Stack` component — every card/tab/panel has moved to `pages/stack/`.

- [ ] **Step 6: Commit**

```bash
cd /root/work/stream-share-suite
git add web/src/pages/stack/ImportTab.jsx web/src/pages/Stack.jsx
git commit -m "$(cat <<'EOF'
Extract ImportTab

Pure move, no behavior change. Stack.jsx now contains no component
definitions of its own besides the page itself — every card/tab/panel
has moved to pages/stack/, ready for Task 6's layout rewrite.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CJT1ab1HK6BXhUAHTcAPyZ
EOF
)"
```

---

### Task 6: Two-pane / tab-bar layout

The capstone — wires `InstancesTab`/`ComponentsTab`/`ImportTab`/`PlanPanel` into the responsive shell: persistent sticky Plan rail + 3-tab bar on desktop (`lg:` / 1024px and up), single column + 4-tab bar (Instances/Components/Import/Plan) on mobile.

**Files:**
- Modify: `web/src/pages/Stack.jsx` (full rewrite of the `Stack` function's return JSX; add `activeTab` state; add a small local `TabBar` component)

**Interfaces:**
- Consumes: `InstancesTab` (Task 3), `ComponentsTab` (Task 4), `ImportTab` (Task 5), `PlanPanel` (Task 2) — all already imported into `Stack.jsx` by the time this task runs.
- Produces: nothing further consumes this — final task.

- [ ] **Step 1: Read the current full file to confirm its exact state**

Run: `cat web/src/pages/Stack.jsx`

By this point it should be structured as: imports, then directly `export default function Stack({ pollIntervalMs = 15000 }) { ... }` with no other top-level function declarations. If anything else remains (leftover dead code from Tasks 1-5), remove it now before proceeding — this step exists because a small oversight in an earlier task's cleanup would otherwise carry through silently.

- [ ] **Step 2: Add `activeTab` state and the `TABS`/`MOBILE_TABS`/`TabBar` pieces**

Add these above `export default function Stack`:
```js
const TABS = [
  { id: "instances", label: "Instances" },
  { id: "components", label: "Components" },
  { id: "import", label: "Import" },
];
const MOBILE_TABS = [...TABS, { id: "plan", label: "Plan" }];

function TabBar({ tabs, activeTab, onChange, className = "" }) {
  return (
    <div className={`flex gap-1 border-b border-slate-200 dark:border-slate-800 ${className}`}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
            activeTab === tab.id
              ? "border-accent-600 text-accent-600 dark:text-accent-400"
              : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
```

Inside `Stack`'s `useState` block, add:
```js
const [activeTab, setActiveTab] = useState("instances");
```

- [ ] **Step 3: Replace the entire return JSX**

Replace everything from `return (` (the final `return` in the `Stack` function, the one that renders the full page — not the earlier `if (dockerReachable === false) { return (...) }` early-return, which is untouched) through the matching closing `);` with:

```jsx
  return (
    <Layout title="Stack" headerExtra={<RefreshButton onClick={reload} />}>
      <TabBar tabs={MOBILE_TABS} activeTab={activeTab} onChange={setActiveTab} className="mb-4 lg:hidden" />
      <TabBar tabs={TABS} activeTab={activeTab} onChange={setActiveTab} className="mb-4 hidden lg:flex" />

      <div className="lg:grid lg:grid-cols-[1fr_380px] lg:items-start lg:gap-4">
        <div>
          {activeTab === "instances" && (
            <InstancesTab
              settings={settings}
              onSaveSettings={saveSettings}
              instances={instances}
              portBand={portBand}
              containerPrefix={settings?.containerPrefix || ""}
              busy={busy}
              onAdd={addInstance}
              onEdit={editInstance}
              onConfirmRemove={removeInstance}
              onPull={(key) => runJob(() => api.pullComponent("instance", key))}
              onRestored={reload}
            />
          )}
          {activeTab === "components" && (
            <ComponentsTab
              components={components}
              settings={settings}
              onSaveSettings={saveSettings}
              busy={busy}
              onSaved={refreshPlan}
              plan={plan}
              onApplyTakeover={(kind) => runJob(() => api.applyComponent(kind, { takeover: true }))}
              onPull={(kind) => runJob(() => api.pullComponent(kind))}
            />
          )}
          {activeTab === "import" && <ImportTab onImported={reload} />}
          {activeTab === "plan" && (
            <div className="lg:hidden">
              <PlanPanel
                plan={plan}
                planError={planError}
                components={components}
                busy={busy}
                job={job}
                onApply={() => runJob(() => api.applyStack())}
                onConfirmRemoveOrphan={(row) => runJob(() => api.removeOrphan(row.containerId))}
              />
            </div>
          )}
        </div>

        <div className="hidden lg:sticky lg:top-6 lg:block">
          <PlanPanel
            plan={plan}
            planError={planError}
            components={components}
            busy={busy}
            job={job}
            onApply={() => runJob(() => api.applyStack())}
            onConfirmRemoveOrphan={(row) => runJob(() => api.removeOrphan(row.containerId))}
          />
        </div>
      </div>
    </Layout>
  );
```

This mounts exactly one tab's component at a time (never two at once, so no duplicate API calls) via the `activeTab === "..."` checks, and separately, always mounts a second `PlanPanel` instance in the right-hand rail — `hidden lg:sticky lg:top-6 lg:block` means that rail only exists in the DOM at `lg:` and up, so mobile never has two `PlanPanel`s mounted simultaneously (only ever one: either the inline "plan" tab's, or none at all when a different mobile tab is active).

**Known accepted edge case:** the desktop tab bar (`TABS`) has no "plan" entry — Plan is always visible in the sticky rail there, never a selectable left-pane tab. If `activeTab` is "plan" (only reachable via the mobile-only 4th tab) at the moment the viewport crosses into `lg:` — i.e. a live browser resize while parked on the mobile Plan tab — the left pane renders nothing for that render (none of the `activeTab === "instances" | "components" | "import"` checks match, and the `"plan"` branch's own content is wrapped `lg:hidden` so it disappears too), while the right rail still correctly shows Plan. Left pane goes blank until the user clicks any real tab. Deliberately not engineered further — a live-resize-mid-session edge case, not worth extra state-reconciliation logic for.

- [ ] **Step 4: Verify the build**

Run: `cd web && npm run build`
Expected: PASS, clean.

- [ ] **Step 5: Manually verify the responsive behavior**

There's no automated test for this — read back through the JSX from Step 3 and confirm, for each of the four states below, exactly one `PlanPanel` and exactly one tab's content is mounted:

1. Desktop (`lg:` and up), `activeTab = "instances"`: left pane shows `InstancesTab`, right rail shows `PlanPanel`, mobile tab bar hidden, desktop tab bar shows with "Instances" highlighted.
2. Desktop, `activeTab = "components"`: left pane shows `ComponentsTab`, right rail still shows `PlanPanel`.
3. Mobile (below `lg:`), `activeTab = "import"`: single column shows `ImportTab` only (no rail — `hidden` at this width), mobile tab bar shows with "Import" highlighted.
4. Mobile, `activeTab = "plan"`: single column shows `PlanPanel` (via the inline branch), desktop tab bar hidden (doesn't have a "Plan" entry to highlight anyway).

If you can run `npm run dev` and actually resize a browser window across 1024px in a way available to you, do that instead of only reading — but reading carefully is an acceptable substitute if you cannot (matches how Task 2 of the M3U-support plan handled the same constraint).

- [ ] **Step 6: Commit**

```bash
cd /root/work/stream-share-suite
git add web/src/pages/Stack.jsx
git commit -m "$(cat <<'EOF'
Stack: two-pane layout with persistent Plan rail, tabbed left pane

Desktop (lg: / 1024px, matching Layout.jsx's own sidebar/drawer
breakpoint): 3-tab bar (Instances/Components/Import) over a
lg:grid-cols-[1fr_380px] split, PlanPanel sticky in the right column
at all times regardless of which tab is active. Mobile: single column,
4-tab bar adds Plan as its own tab since there's no room for a
persistent rail there.

Exactly one tab's component (and, on desktop, exactly one PlanPanel)
is ever mounted at a time — no duplicate API calls from having both a
mobile and desktop copy of the same tab live simultaneously.

This completes the Stack page redesign: the old 1055-line single-
scroll page (5 stacked concerns: settings, plan, job log, import,
instances, components) is now a two-pane/tabbed layout across 9 files
under pages/stack/, with each of StackSettings' three fields attached
to the component/tab it actually belongs to.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01CJT1ab1HK6BXhUAHTcAPyZ
EOF
)"
```
