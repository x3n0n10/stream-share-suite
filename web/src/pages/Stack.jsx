import { useCallback, useEffect, useState } from "react";
import Layout from "../components/Layout.jsx";
import { ErrorNote, RefreshButton } from "../components/common.jsx";
import { api, ApiError } from "../lib/api.js";
import { useJobPolling } from "../lib/useJobPolling.js";
import PlanPanel from "./stack/PlanPanel.jsx";
import InstancesTab from "./stack/InstancesTab.jsx";
import ComponentsTab from "./stack/ComponentsTab.jsx";
import ImportTab from "./stack/ImportTab.jsx";

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

export default function Stack({ pollIntervalMs = 15000 }) {
  const [dockerReachable, setDockerReachable] = useState(null);
  const [components, setComponents] = useState([]);
  const [settings, setSettings] = useState(null);
  const [instances, setInstances] = useState([]);
  const [portBand, setPortBand] = useState(null);
  const [plan, setPlan] = useState(null);
  const [planError, setPlanError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState("instances");

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

        {activeTab !== "plan" && (
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
        )}
      </div>
    </Layout>
  );
}
