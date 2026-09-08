import { useEffect, useState } from "react";
import { Card, Button, ErrorNote, FIELD } from "../../components/common.jsx";
import { api } from "../../lib/api.js";

export default function StepPortRange({ onNext }) {
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.stackSettings().then((s) => {
      setSettings(s);
      setDraft(String(s.instancePortStart));
    });
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.saveStackSettings({ instancePortStart: Number(draft) });
      onNext("instances");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">Instance port range</h2>
      <p className="mt-1.5 max-w-prose text-sm text-slate-500 dark:text-slate-400">
        Each instance gets its own port, allocated from a band of 20 starting here. Only worth
        changing if that range is already taken by something else on the host.
      </p>

      <div className="mt-5">
        {settings === null ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="number"
              className={`${FIELD} w-32`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <span className="text-sm text-slate-500 dark:text-slate-400">
              – {Number(draft) + 19 || "…"}
            </span>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3">
          <ErrorNote message={error} />
        </div>
      )}

      <div className="mt-5">
        <Button tone="accent" onClick={save} loading={saving} disabled={settings === null}>
          Save and continue
        </Button>
      </div>
    </Card>
  );
}
