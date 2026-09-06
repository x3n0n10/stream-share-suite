import { useEffect, useState } from "react";
import { Card, Button, ErrorNote } from "../../components/common.jsx";
import SchemaForm from "../../components/SchemaForm.jsx";
import { api } from "../../lib/api.js";

export default function StepVpn({ onNext }) {
  const [choice, setChoice] = useState(null); // null | true | false
  const [fields, setFields] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (choice && !fields) api.componentFields("gluetun").then((r) => setFields(r.fields));
  }, [choice, fields]);

  async function chooseVpn(enabled) {
    setError(null);
    setChoice(enabled);
    try {
      await api.saveStackSettings({ vpnEnabled: enabled });
      if (!enabled) onNext("done");
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

  if (choice === null) {
    return (
      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Route traffic through a VPN?</h2>
        <p className="mt-1.5 max-w-prose text-sm text-slate-500 dark:text-slate-400">
          Recommended if your provider restricts access by location or IP. Every instance shares one
          tunnel — this isn't per-instance. You can change this later under Stack.
        </p>
        {error && (
          <div className="mt-3">
            <ErrorNote message={error} />
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <Button tone="accent" onClick={() => chooseVpn(true)}>
            Yes, use a VPN
          </Button>
          <Button tone="ghost" onClick={() => chooseVpn(false)}>
            No, skip it
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">Gluetun (VPN)</h2>
      <p className="mt-1.5 max-w-prose text-sm text-slate-500 dark:text-slate-400">
        The tunnel every instance's traffic will route through. This container also publishes every
        instance's port, so it's configured now.
      </p>
      <div className="mt-5">
        {fields === null ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <SchemaForm fields={fields} onSave={saveGluetun} saving={saving} error={error} submitLabel="Save and continue" />
        )}
      </div>
    </Card>
  );
}
