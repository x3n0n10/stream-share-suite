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
          .join(" and ")} ${switchedOff.length === 1 ? "is" : "are"} switched off. Turn the VPN back on under the Components tab to manage it again.`
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
