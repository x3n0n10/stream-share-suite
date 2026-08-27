import { useEffect, useRef, useState } from "react";
import Layout from "../components/Layout.jsx";
import { Card, Badge, Button, ErrorNote } from "../components/common.jsx";
import SchemaForm from "../components/SchemaForm.jsx";
import { api, ApiError } from "../lib/api.js";

// Phase 1 proves the reconciler on exactly one component — gluetun, the
// highest-risk one, since everything else shares its network namespace. Later
// phases add more kinds; this page becomes a loop over them rather than a
// hardcoded "gluetun" once there is more than one.
const KIND = "gluetun";

const ACTION_COPY = {
  create: { label: "Will create", tone: "accent" },
  recreate: { label: "Will recreate", tone: "rose" },
  adopt: { label: "Found, unmanaged", tone: "amber" },
  noop: { label: "Up to date", tone: "slate" },
};

function ActionBadge({ action }) {
  const copy = ACTION_COPY[action] || { label: action, tone: "slate" };
  return <Badge tone={copy.tone}>{copy.label}</Badge>;
}

export default function Stack() {
  const [dockerReachable, setDockerReachable] = useState(null);
  const [fields, setFields] = useState(null);
  const [plan, setPlan] = useState(null);
  const [planIncomplete, setPlanIncomplete] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [job, setJob] = useState(null);
  const [applying, setApplying] = useState(false);
  const pollRef = useRef(null);

  async function reload() {
    const [status, componentRes] = await Promise.all([
      api.dockerStatus().catch(() => ({ reachable: false })),
      api.componentFields(KIND),
    ]);
    setDockerReachable(status.reachable);
    setFields(componentRes.fields);
    await refreshPlan();
  }

  async function refreshPlan() {
    try {
      const result = await api.componentPlan(KIND);
      setPlan(result);
      setPlanIncomplete(false);
    } catch (err) {
      if (err instanceof ApiError && err.body?.incomplete) {
        setPlan(null);
        setPlanIncomplete(true);
      } else {
        setPlan(null);
        setPlanIncomplete(false);
      }
    }
  }

  useEffect(() => {
    reload();
    return () => clearTimeout(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(patch) {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await api.saveComponent(KIND, patch);
      setFields(result.fields);
      await refreshPlan();
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function pollJob(jobId) {
    clearTimeout(pollRef.current);
    pollRef.current = setTimeout(async () => {
      const current = await api.job(jobId).catch(() => null);
      if (!current) return;
      setJob(current);
      if (current.status === "running") {
        pollJob(jobId);
      } else {
        setApplying(false);
        refreshPlan();
      }
    }, 500);
  }

  async function apply(takeover) {
    setApplying(true);
    setJob(null);
    try {
      const { jobId } = await api.applyComponent(KIND, { takeover });
      pollJob(jobId);
    } catch (err) {
      setApplying(false);
      setJob({ status: "failed", error: err.message, log: [] });
    }
  }

  return (
    <Layout title="Stack">
      {dockerReachable === false && (
        <div className="mb-4">
          <ErrorNote message="Can't reach the Docker socket proxy. Set DOCKER_PROXY_URL, or check that the docker-socket-proxy service is running and reachable." />
        </div>
      )}

      <div className="flex flex-col gap-4">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Gluetun (VPN)</h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                The highest-risk component: every StreamShare instance, Caddy and UHF share its network
                namespace. Recreating it recreates all of them.
              </p>
            </div>
            {plan && <ActionBadge action={plan.action} />}
          </div>

          {fields === null ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : (
            <SchemaForm fields={fields} onSave={save} saving={saving} error={saveError} submitLabel="Save configuration" />
          )}
        </Card>

        {planIncomplete && (
          <Card className="p-5">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Save a complete configuration above to see what applying it would do.
            </p>
          </Card>
        )}

        {plan && (
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Plan</h2>
            <PlanSummary plan={plan} />

            <div className="mt-4 flex items-center gap-2">
              <Button tone="accent" onClick={() => apply(false)} loading={applying} disabled={applying || plan.action === "noop"}>
                {plan.action === "noop" ? "Nothing to apply" : "Apply"}
              </Button>
              {plan.action === "adopt" && (
                <Button tone="rose" onClick={() => apply(true)} loading={applying} disabled={applying}>
                  Take over anyway
                </Button>
              )}
            </div>

            {job && <JobLog job={job} />}
          </Card>
        )}
      </div>
    </Layout>
  );
}

function PlanSummary({ plan }) {
  if (plan.action === "noop") {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Already matches the desired configuration.</p>;
  }
  if (plan.action === "adopt") {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        A container named <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{plan.spec.name}</code> is
        already running without the Suite's labels — almost certainly one you set up by hand. Applying will leave
        it exactly as it is. "Take over anyway" stops and replaces it with a managed one instead.
      </p>
    );
  }
  if (plan.action === "recreate") {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        The saved configuration differs from what's running. Applying stops, removes, and recreates{" "}
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{plan.spec.name}</code> — every instance
        sharing its network namespace loses its connection until it comes back up.
      </p>
    );
  }
  return (
    <p className="text-sm text-slate-500 dark:text-slate-400">
      No container named <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{plan.spec.name}</code> exists
      yet. Applying creates and starts it with {plan.spec.env.length} environment variable
      {plan.spec.env.length === 1 ? "" : "s"} set.
    </p>
  );
}

function JobLog({ job }) {
  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
      <div className="mb-2 flex items-center gap-2">
        <Badge tone={job.status === "success" ? "green" : job.status === "failed" ? "rose" : "slate"}>
          {job.status}
        </Badge>
      </div>
      <div className="max-h-48 overflow-y-auto font-mono text-xs text-slate-600 dark:text-slate-400">
        {(job.log || []).map((entry, i) => (
          <div key={i}>{entry.line}</div>
        ))}
        {job.error && <div className="text-rose-600 dark:text-rose-400">{job.error}</div>}
      </div>
    </div>
  );
}
