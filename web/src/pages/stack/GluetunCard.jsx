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
