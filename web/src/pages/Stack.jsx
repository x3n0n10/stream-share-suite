import { useCallback, useEffect, useState } from "react";
import Layout from "../components/Layout.jsx";
import { Card, Button, ErrorNote, RefreshButton } from "../components/common.jsx";
import { api, ApiError } from "../lib/api.js";
import { useJobPolling } from "../lib/useJobPolling.js";
import PlanPanel from "./stack/PlanPanel.jsx";
import InstancesTab from "./stack/InstancesTab.jsx";
import ComponentsTab from "./stack/ComponentsTab.jsx";

export default function Stack({ pollIntervalMs = 15000 }) {
  const [dockerReachable, setDockerReachable] = useState(null);
  const [components, setComponents] = useState([]);
  const [settings, setSettings] = useState(null);
  const [instances, setInstances] = useState([]);
  const [portBand, setPortBand] = useState(null);
  const [plan, setPlan] = useState(null);
  const [planError, setPlanError] = useState(null);
  const [busy, setBusy] = useState(false);

  const refreshPlan = useCallback(async () => {
    try {
      const result = await api.stackPlan();
      setPlan(result);
      setPlanError(null);
    } catch (err) {
      setPlan(null);
      setPlanError(err instanceof ApiError ? err.message : String(err));
    }
  }, []);

  const reload = useCallback(async () => {
    const [status, list, stackSettings, instanceList] = await Promise.all([
      api.dockerStatus().catch(() => ({ reachable: false })),
      api.stackComponents().catch(() => ({ components: [] })),
      api.stackSettings().catch(() => null),
      api.stackInstances().catch(() => ({ instances: [], portBand: null })),
    ]);
    setDockerReachable(status.reachable);
    setComponents(list.components);
    setSettings(stackSettings);
    setInstances(instanceList.instances);
    setPortBand(instanceList.portBand);
    if (status.reachable) await refreshPlan();
  }, [refreshPlan]);

  const { job, setJob, poll: pollJob } = useJobPolling(api.job, 500, () => {
    setBusy(false);
    refreshPlan();
  });

  useEffect(() => {
    reload();
  }, [reload]);

  // A container's own status can keep settling for a moment after a job
  // finishes (a health check's start_period, say) — the one refresh right
  // after Apply/Check for updates completes can catch it mid-transition,
  // same as every other status this app polls rather than fetches once.
  useEffect(() => {
    if (!dockerReachable) return;
    const id = setInterval(refreshPlan, pollIntervalMs);
    return () => clearInterval(id);
  }, [dockerReachable, refreshPlan, pollIntervalMs]);

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

  async function saveSettings(patch) {
    const next = await api.saveStackSettings(patch);
    setSettings(next);
    await reload();
  }

  async function addInstance(patch) {
    await api.createStackInstance(patch);
    await reload();
  }

  async function editInstance(key, patch) {
    await api.updateStackInstance(key, patch);
    await reload();
  }

  async function removeInstance(key, opts) {
    await runJob(() => api.removeStackInstance(key, opts));
    await reload();
  }

  if (dockerReachable === false) {
    return (
      <Layout title="Stack" headerExtra={<RefreshButton onClick={reload} />}>
        <ErrorNote message="Can't reach the Docker socket proxy. Set DOCKER_PROXY_URL, or check that the docker-socket-proxy service is running and reachable." />
      </Layout>
    );
  }

  return (
    <Layout title="Stack" headerExtra={<RefreshButton onClick={reload} />}>
      <div className="flex flex-col gap-4">
        <PlanPanel
          plan={plan}
          planError={planError}
          components={components}
          busy={busy}
          job={job}
          onApply={() => runJob(() => api.applyStack())}
          onConfirmRemoveOrphan={(row) => runJob(() => api.removeOrphan(row.containerId))}
        />

        <ImportCard onImported={reload} />

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
      </div>
    </Layout>
  );
}

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
function ImportCard({ onImported }) {
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
