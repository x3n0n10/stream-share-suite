import { useState } from "react";
import { Card, Button, ErrorNote, FIELD } from "../../components/common.jsx";
import { api } from "../../lib/api.js";
import { describeFailures } from "../../lib/applyToAll.js";

export default function StepHealthCheck({ instances, onNext }) {
  const [selected, setSelected] = useState({}); // key -> bool
  const [streamIds, setStreamIds] = useState({}); // key -> string
  const [checkTimes, setCheckTimes] = useState("04:00,16:00");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function toggle(key) {
    setSelected((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const chosen = instances.filter((i) => selected[i.key]);
  const allStreamIdsFilled = chosen.every((i) => (streamIds[i.key] || "").trim());

  async function submit() {
    if (chosen.length === 0) {
      onNext("done");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const results = await Promise.allSettled(
        chosen.map((i) =>
          api.updateStackInstance(i.key, {
            healthCheckEnabled: true,
            healthCheckStreamId: streamIds[i.key],
          })
        )
      );
      const failureMessage = describeFailures(
        chosen.map((i) => ({ name: i.displayName })),
        results
      );
      if (failureMessage) {
        setError(failureMessage);
        return;
      }
      await api.saveWatchdogSettings({ enabled: true, checkTimes });
      onNext("done");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">Health check</h2>
      <p className="mt-1.5 max-w-prose text-sm text-slate-500 dark:text-slate-400">
        Optional. Lets the VPN watchdog reconnect the tunnel when a provider blocks the current exit
        IP — pick which instances to watch.
      </p>

      <div className="mt-5 flex flex-col gap-2">
        {instances.map((instance) => (
          <label key={instance.key} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={!!selected[instance.key]}
              onChange={() => toggle(instance.key)}
              className="h-4 w-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
            />
            {instance.displayName}
          </label>
        ))}
      </div>

      {chosen.length > 0 && (
        <div className="mt-5 border-t border-slate-200 pt-5 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Probe channel per instance</h3>
          <div className="mt-3 flex flex-col gap-3">
            {chosen.map((instance) => (
              <label key={instance.key} className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  {instance.displayName} — Stream ID
                </span>
                <input
                  className={FIELD}
                  value={streamIds[instance.key] || ""}
                  onChange={(e) => setStreamIds((prev) => ({ ...prev, [instance.key]: e.target.value }))}
                  placeholder="12345.ts"
                />
              </label>
            ))}
          </div>

          <label className="mt-4 flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Check times (local, HH:MM)
            </span>
            <input className={FIELD} value={checkTimes} onChange={(e) => setCheckTimes(e.target.value)} />
          </label>
        </div>
      )}

      {error && (
        <div className="mt-4">
          <ErrorNote message={error} />
        </div>
      )}

      <div className="mt-5 flex items-center gap-2">
        <Button
          tone="accent"
          onClick={submit}
          loading={saving}
          disabled={saving || (chosen.length > 0 && !allStreamIdsFilled)}
        >
          {chosen.length > 0 ? "Save and continue" : "Skip"}
        </Button>
      </div>
    </Card>
  );
}
