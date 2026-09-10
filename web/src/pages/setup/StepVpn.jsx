import { useEffect, useState } from "react";
import { Card, Button, ErrorNote, OnOffToggle } from "../../components/common.jsx";
import SchemaForm from "../../components/SchemaForm.jsx";
import { api } from "../../lib/api.js";

export default function StepVpn({ onNext, onBack }) {
  const [vpnEnabled, setVpnEnabled] = useState(null); // null until seeded
  const [fields, setFields] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.stackSettings().then((s) => setVpnEnabled(s.vpnEnabled));
  }, []);

  useEffect(() => {
    if (vpnEnabled && !fields) api.componentFields("gluetun").then((r) => setFields(r.fields));
  }, [vpnEnabled, fields]);

  async function toggleVpn(enabled) {
    setError(null);
    try {
      await api.saveStackSettings({ vpnEnabled: enabled });
      setVpnEnabled(enabled);
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveGluetun(patch) {
    setSaving(true);
    setError(null);
    try {
      await api.saveComponent("gluetun", patch);
      onNext("health");
    } catch (err) {
      setError(err.body?.errors?.map((e) => e.message).join(" ") || err.message);
    } finally {
      setSaving(false);
    }
  }

  if (vpnEnabled === null) {
    return (
      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">VPN</h2>
        <p className="mt-5 text-sm text-slate-400">Loading…</p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">Route traffic through a VPN?</h2>
      <p className="mt-1.5 max-w-prose text-sm text-slate-500 dark:text-slate-400">
        Recommended if your provider restricts access by location or IP. Every instance shares one
        tunnel — this isn't per-instance.
      </p>

      {error && !vpnEnabled && (
        <div className="mt-3">
          <ErrorNote message={error} />
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-sm text-slate-700 dark:text-slate-300">Use a VPN</span>
        <OnOffToggle value={vpnEnabled} onChange={toggleVpn} />
      </div>

      {vpnEnabled ? (
        <div className="mt-5 border-t border-slate-200 pt-5 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Gluetun (VPN)</h3>
          <p className="mt-1 max-w-prose text-xs text-slate-500 dark:text-slate-400">
            The tunnel every instance's traffic will route through. This container also publishes
            every instance's port.
          </p>
          <div className="mt-4">
            {fields === null ? (
              <p className="text-sm text-slate-400">Loading…</p>
            ) : (
              <SchemaForm
                fields={fields}
                onSave={saveGluetun}
                saving={saving}
                error={error}
                submitLabel="Continue"
                secondaryAction={
                  onBack && (
                    <Button tone="ghost" onClick={onBack}>
                      Back
                    </Button>
                  )
                }
              />
            )}
          </div>
        </div>
      ) : (
        <div className="mt-5 flex items-center gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
          {onBack && (
            <Button tone="ghost" onClick={onBack}>
              Back
            </Button>
          )}
          <div className="ml-auto">
            <Button tone="accent" onClick={() => onNext("done")}>
              Continue
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
