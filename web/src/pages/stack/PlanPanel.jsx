// web/src/pages/stack/PlanPanel.jsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { serverText, jobLine } from "../../lib/serverText.js";
import { useFormat } from "../../lib/useFormat.js";
import { catalogText } from "../../lib/schemaKeys.js";
import { Card, Badge, Button, ErrorNote, ConfirmDialog } from "../../components/common.jsx";

// How each plan action reads on screen. The wording matters more than usual
// here: this is the last thing anyone sees before containers get replaced.
const ACTION_TONE = {
  create: "accent",
  recreate: "rose",
  adopt: "amber",
  noop: "slate",
  orphaned: "amber",
  disabled: "slate",
  incomplete: "slate",
};

function ActionBadge({ action }) {
  const { t } = useTranslation();
  return <Badge tone={ACTION_TONE[action] || "slate"}>{t(`stack.plan.action.${action}`, { defaultValue: action })}</Badge>;
}


// Live container state, alongside the action badge's config-drift verdict —
// "will this change" and "is this actually running right now" are different
// questions, and a noop row can still be a container stuck restarting.
const RUNTIME_TONE = {
  running: "green",
  restarting: "amber",
  paused: "amber",
  exited: "rose",
  dead: "rose",
  created: "slate",
};
const HEALTH_TONE = { healthy: "green", unhealthy: "rose", starting: "amber" };

function RuntimeBadges({ runtime }) {
  const { t } = useTranslation();
  if (!runtime) return null;
  return (
    <>
      <Badge tone={RUNTIME_TONE[runtime.status] || "slate"}>
        {t(`stack.plan.runtime.${runtime.status}`, { defaultValue: runtime.status })}
      </Badge>
      {HEALTH_TONE[runtime.health] && (
        <Badge tone={HEALTH_TONE[runtime.health]}>{t(`stack.plan.health.${runtime.health}`)}</Badge>
      )}
    </>
  );
}

// An empty plan means one of two quite different things, and saying the wrong
// one is worse than saying nothing: a fresh install has nothing configured,
// while a stack whose only component is switched off has everything configured
// and simply isn't running any of it.
function EmptyPlan({ components }) {
  const { t } = useTranslation();
  const { formatList } = useFormat();
  const switchedOff = components.filter((component) => !component.active);

  return (
    <p className="px-5 py-6 text-sm text-slate-500 dark:text-slate-400">
      {switchedOff.length > 0 ? (
        t("stack.plan.emptySwitchedOff", {
          count: switchedOff.length,
          list: formatList(switchedOff.map((component) => catalogText(t, component, "label"))),
        })
      ) : (
        <Trans
          i18nKey="stack.plan.emptyFresh"
          components={{
            setup: (
              <Link to="/setup" className="font-medium text-accent-600 hover:underline dark:text-accent-400" />
            ),
          }}
        />
      )}
    </p>
  );
}

function PlanSummary({ summary }) {
  const { t } = useTranslation();
  const parts = [];
  if (summary.changes > 0) parts.push(t("stack.plan.summary.changes", { count: summary.changes }));
  if (summary.restarts > 0) parts.push(t("stack.plan.summary.restarts", { count: summary.restarts }));
  if (summary.orphans > 0) parts.push(t("stack.plan.summary.orphans", { count: summary.orphans }));
  if (summary.disabled > 0) parts.push(t("stack.plan.summary.disabled", { count: summary.disabled }));
  if (summary.incomplete > 0) parts.push(t("stack.plan.summary.incomplete", { count: summary.incomplete }));

  // "Everything matches" is only true when there is something to match.
  if (parts.length === 0) {
    parts.push(summary.total === 0 ? t("stack.plan.summary.nothing") : t("stack.plan.summary.matches"));
  }
  return parts.join(" · ");
}

function PlanRow({ row, ordinal, onRemoveOrphan }) {
  const { t } = useTranslation();
  const cascaded = !!row.cascadedFrom;
  // noop's reason is always the same boilerplate ("Matches the saved
  // configuration") — only worth a line when the row is doing something.
  const explain = row.action !== "noop" && row.reason;

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
          {row.spec?.name || row.containerName || catalogText(t, row, "label")}
        </p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{catalogText(t, row, "label")}</p>
        {row.runtime && (
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <RuntimeBadges runtime={row.runtime} />
            {row.runtime.image && (
              <span className="font-mono text-slate-400 dark:text-slate-500">{row.runtime.image}</span>
            )}
          </p>
        )}
        {(row.warnings || []).map((warning, i) => (
          <p key={warning} className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            {serverText(t, "plan.warning", row.warningsI18n?.[i], warning)}
          </p>
        ))}
        {explain && <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{serverText(t, "plan.reason", row.reasonI18n, row.reason)}</p>}
      </div>
      <div className="flex items-center gap-2">
        {row.action === "orphaned" && (
          <button
            onClick={() => onRemoveOrphan(row)}
            className="text-xs font-medium text-rose-600 hover:underline dark:text-rose-400"
          >
            {t("common.remove")}
          </button>
        )}
        <ActionBadge action={row.action} />
      </div>
    </li>
  );
}

function JobLog({ job }) {
  const { t } = useTranslation();
  return (
    <Card className="p-5">
      <div className="mb-2 flex items-center gap-2">
        <Badge tone={job.status === "success" ? "green" : job.status === "failed" ? "rose" : "slate"}>
          {t(`common.jobStatus.${job.status}`, { defaultValue: job.status })}
        </Badge>
      </div>
      <div className="max-h-64 overflow-y-auto font-mono text-xs text-slate-600 dark:text-slate-400">
        {(job.log || []).map((entry, i) => (
          <div key={i}>{jobLine(t, entry)}</div>
        ))}
        {job.error && (
          <div className="text-rose-600 dark:text-rose-400">{serverText(t, "errors", job.errorI18n, job.error)}</div>
        )}
      </div>
    </Card>
  );
}

// The live diff between stored config and real Docker state, plus Apply and
// the job log — this is what stays visible regardless of which other tab is
// open, since editing any of them changes what this shows.
export default function PlanPanel({ plan, planError, components, busy, job, onApply, onConfirmRemoveOrphan }) {
  const { t } = useTranslation();
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
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t("stack.plan.title")}</h2>
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
                ? t("stack.plan.nothingToApply")
                : t("stack.plan.apply", { count: plan.summary.changes })}
            </Button>
          </div>
        </Card>
      )}

      {job && <JobLog job={job} />}

      <ConfirmDialog
        open={!!orphanToConfirm}
        title={t("stack.plan.removeTitle")}
        body={
          orphanToConfirm
            ? t("stack.plan.removeBody", { name: orphanToConfirm.containerName })
            : ""
        }
        confirmLabel={t("common.remove")}
        onConfirm={confirmRemoveOrphan}
        onCancel={() => setOrphanToConfirm(null)}
      />
    </div>
  );
}
