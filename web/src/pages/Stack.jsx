import { useCallback, useEffect, useState } from "react";
import Layout from "../components/Layout.jsx";
import { ErrorNote, RefreshButton } from "../components/common.jsx";
import { api, ApiError } from "../lib/api.js";
import { useJobPolling } from "../lib/useJobPolling.js";
import PlanPanel from "./stack/PlanPanel.jsx";
import InstancesTab from "./stack/InstancesTab.jsx";
import ComponentsTab from "./stack/ComponentsTab.jsx";
import ImportTab from "./stack/ImportTab.jsx";

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

        <ImportTab onImported={reload} />

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
