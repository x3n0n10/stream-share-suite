import { useCallback, useEffect, useRef, useState } from "react";
import Layout from "../components/Layout.jsx";
import { Card, Badge, Button, ErrorNote, ConfirmDialog } from "../components/common.jsx";
import SchemaForm from "../components/SchemaForm.jsx";
import { api, ApiError } from "../lib/api.js";

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

export default function Stack() {
  const [dockerReachable, setDockerReachable] = useState(null);
  const [components, setComponents] = useState([]);
  const [vpnEnabled, setVpnEnabled] = useState(null);
  const [plan, setPlan] = useState(null);
  const [planError, setPlanError] = useState(null);
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [orphanToRemove, setOrphanToRemove] = useState(null);
  const pollRef = useRef(null);

  const refreshPlan = useCallback(async () => {
    try {
      const result = await api.stackPlan();
      setPlan(result);
      setVpnEnabled(result.vpnEnabled);
      setPlanError(null);
    } catch (err) {
      setPlan(null);
      setPlanError(err instanceof ApiError ? err.message : String(err));
    }
  }, []);

  const reload = useCallback(async () => {
    const [status, list] = await Promise.all([
      api.dockerStatus().catch(() => ({ reachable: false })),
      api.stackComponents().catch(() => ({ components: [] })),
    ]);
    setDockerReachable(status.reachable);
    setComponents(list.components);
    if (status.reachable) await refreshPlan();
  }, [refreshPlan]);

  useEffect(() => {
    reload();
    return () => clearTimeout(pollRef.current);
  }, [reload]);

  function pollJob(jobId) {
    clearTimeout(pollRef.current);
    pollRef.current = setTimeout(async () => {
      const current = await api.job(jobId).catch(() => null);
      if (!current) return;
      setJob(current);
      if (current.status === "running") {
        pollJob(jobId);
      } else {
        setBusy(false);
        refreshPlan();
      }
    }, 500);
  }

  async function runJob(start) {
    setBusy(true);
    setJob(null);
    try {
      const { jobId } = await start();
      pollJob(jobId);
    } catch (err) {
      setBusy(false);
      setJob({ status: "failed", error: err.message, log: [] });
    }
  }

  async function toggleVpn(next) {
    setVpnEnabled(next);
    await api.saveStackSettings({ vpnEnabled: next });
    await reload();
  }

  async function confirmRemoveOrphan() {
    const target = orphanToRemove;
    setOrphanToRemove(null);
    await runJob(() => api.removeOrphan(target.containerId));
  }

  if (dockerReachable === false) {
    return (
      <Layout title="Stack">
        <ErrorNote message="Can't reach the Docker socket proxy. Set DOCKER_PROXY_URL, or check that the docker-socket-proxy service is running and reachable." />
      </Layout>
    );
  }

  return (
    <Layout title="Stack">
      <div className="flex flex-col gap-4">
        <VpnToggle enabled={vpnEnabled} onChange={toggleVpn} disabled={busy} />

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

        {components.map((component) => (
          <ComponentCard
            key={component.kind}
            component={component}
            onSaved={refreshPlan}
            busy={busy}
            onApplyTakeover={() =>
              runJob(() => api.applyComponent(component.kind, { takeover: true }))
            }
            takeoverAvailable={
              plan?.plans.some((row) => row.kind === component.kind && row.action === "adopt") || false
            }
          />
        ))}
      </div>

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
    </Layout>
  );
}

function VpnToggle({ enabled, onChange, disabled }) {
  if (enabled === null) return null;

  return (
    <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
          Route traffic through a VPN
        </h2>
        <p className="mt-1 max-w-prose text-xs text-slate-500 dark:text-slate-400">
          {enabled
            ? "Instances, Caddy and the recorder share gluetun's network namespace. Replacing gluetun briefly takes them with it."
            : "Every container gets its own network. Turning this back on rebuilds everything that would share the tunnel."}
        </p>
      </div>
      <label className="flex shrink-0 items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
        />
        {enabled ? "On" : "Off"}
      </label>
    </Card>
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
      {switchedOff.length > 0
        ? `Nothing in the stack right now — ${switchedOff
            .map((component) => component.label)
            .join(" and ")} ${switchedOff.length === 1 ? "is" : "are"} switched off. Turn the VPN back on above to manage it again.`
        : "Nothing in the stack yet. Configure a component below to get started."}
    </p>
  );
}

function PlanCard({ plan, components, busy, onApply, onRemoveOrphan }) {
  const { plans, summary } = plan;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Stack plan</h2>
        <p className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
          <PlanSummary summary={summary} />
        </p>
      </div>

      {plans.length === 0 ? (
        <EmptyPlan components={components} />
      ) : (
        <ul>
          {plans.map((row, index) => (
            <PlanRow key={row.id + row.action} row={row} ordinal={index + 1} onRemoveOrphan={onRemoveOrphan} />
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
        <Button tone="accent" onClick={onApply} loading={busy} disabled={busy || summary.changes === 0}>
          {summary.changes === 0
            ? "Nothing to apply"
            : `Apply ${summary.changes} change${summary.changes === 1 ? "" : "s"}`}
        </Button>
      </div>
    </Card>
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

function ComponentCard({ component, onSaved, busy, takeoverAvailable, onApplyTakeover }) {
  const [fields, setFields] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || fields) return;
    api.componentFields(component.kind).then((res) => setFields(res.fields));
  }, [open, fields, component.kind]);

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
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-xs font-medium text-accent-600 hover:underline dark:text-accent-400"
          >
            {open ? "Hide" : "Configure"}
          </button>
        </div>
      </div>

      {open && (
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
      )}
    </Card>
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
