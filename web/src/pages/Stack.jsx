import { useCallback, useEffect, useState } from "react";
import Layout from "../components/Layout.jsx";
import { Card, Badge, Button, ErrorNote, RefreshButton } from "../components/common.jsx";
import { IconRefresh, IconSettings } from "../components/Icons.jsx";
import SchemaForm from "../components/SchemaForm.jsx";
import { api, ApiError } from "../lib/api.js";
import { useJobPolling } from "../lib/useJobPolling.js";
import HistoryPanel from "./stack/HistoryPanel.jsx";
import PlanPanel from "./stack/PlanPanel.jsx";
import InstancesTab from "./stack/InstancesTab.jsx";

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
        {settings && <StackSettings settings={settings} onSave={saveSettings} busy={busy} />}

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
      </div>
    </Layout>
  );
}

// The data path is SUITE_DATA_DIR, set once in compose — deliberately not
// shown here. A UI override would just be retyping the same string the
// compose file already carries; a path that is wrong still surfaces, as an
// "incomplete" row on whichever component needs it, which is where a bad
// value actually has a consequence worth explaining.
function StackSettings({ settings, onSave, busy }) {
  return (
    <Card className="flex flex-col gap-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Route traffic through a VPN
          </h2>
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
            onChange={(e) => onSave({ vpnEnabled: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
          />
          {settings.vpnEnabled ? "On" : "Off"}
        </label>
      </div>

      <OptionalComponentToggle
        title="Caddy (reverse proxy)"
        description="Publishes any instance with a public base URL under a real hostname, with HTTPS handled for you."
        checked={settings.caddyEnabled}
        settingKey="caddyEnabled"
        onSave={onSave}
        busy={busy}
      />
    </Card>
  );
}

// Caddy is an optional bolt-on most deployments don't run, so it gets a
// switch of its own here rather than showing up permanently as "not
// configured" — the same shape as the VPN toggle above, just without the
// longer explanation that one needs.
function OptionalComponentToggle({ title, description, checked, settingKey, onSave, busy }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-5 dark:border-slate-800">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h2>
        <p className="mt-1 max-w-prose text-xs text-slate-500 dark:text-slate-400">{description}</p>
      </div>
      <label className="flex shrink-0 items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        <input
          type="checkbox"
          checked={!!checked}
          disabled={busy}
          onChange={(e) => onSave({ [settingKey]: e.target.checked })}
          className="h-4 w-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
        />
        {checked ? "On" : "Off"}
      </label>
    </div>
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

function ComponentCard({ component, onSaved, busy, takeoverAvailable, onApplyTakeover, onPull }) {
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
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close" : "Configure"}
            title={open ? "Close" : "Configure"}
            className="rounded-lg p-1.5 text-accent-600 hover:bg-accent-50 dark:text-accent-400 dark:hover:bg-accent-900/30"
          >
            {open ? <span className="text-xs font-medium">Close</span> : <IconSettings className="h-4 w-4" />}
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
      )}
    </Card>
  );
}
