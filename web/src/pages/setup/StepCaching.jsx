import { useState } from "react";
import { Card, Button, ErrorNote } from "../../components/common.jsx";
import { api } from "../../lib/api.js";
import { describeFailures } from "../../lib/applyToAll.js";

const FIELD =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
  "placeholder:text-slate-400 focus:border-accent-500 focus:outline-none focus:ring-1 " +
  "focus:ring-accent-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white";

export default function StepCaching({ instances, onNext }) {
  const [vodCacheEnabled, setVodCacheEnabled] = useState(false);
  const [catchupEnabled, setCatchupEnabled] = useState(false);
  const [catchupDurationHours, setCatchupDurationHours] = useState("4");
  const [parentPath, setParentPath] = useState("");
  // key -> suggested/edited full path, seeded from parentPath once it's typed.
  const [cachePaths, setCachePaths] = useState({});
  // key -> the last value we auto-suggested for it, so a later parent-path
  // edit knows whether to re-suggest (untouched) or leave it alone (the user
  // already typed something different).
  const [suggestedFor, setSuggestedFor] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const cachingOn = vodCacheEnabled || catchupEnabled;

  function updateParentPath(value) {
    setParentPath(value);
    const trimmedRoot = value.replace(/\/+$/, "");
    const suggestions = Object.fromEntries(
      instances.map((i) => [i.key, value ? `${trimmedRoot}/${i.key}` : ""])
    );

    setCachePaths((prev) => {
      const next = { ...prev };
      for (const instance of instances) {
        // Only overwrite a path the user hasn't hand-edited away from the
        // previous suggestion for this same parent.
        if (!prev[instance.key] || prev[instance.key] === suggestedFor[instance.key]) {
          next[instance.key] = suggestions[instance.key];
        }
      }
      return next;
    });
    setSuggestedFor(suggestions);
  }

  const allPathsFilled = !cachingOn || instances.every((i) => (cachePaths[i.key] || "").trim());

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const patch = {
        vodCacheEnabled: vodCacheEnabled ? "true" : "false",
        catchupEnabled: catchupEnabled ? "true" : "false",
        ...(catchupEnabled ? { catchupDurationHours } : {}),
      };
      const results = await Promise.allSettled(
        instances.map((i) =>
          api.updateStackInstance(i.key, { ...patch, ...(cachingOn ? { cachePath: cachePaths[i.key] } : {}) })
        )
      );
      const failureMessage = describeFailures(
        instances.map((i) => ({ name: i.displayName })),
        results
      );
      if (failureMessage) {
        setError(failureMessage);
        return;
      }
      onNext("database");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">Caching</h2>
      <p className="mt-1.5 max-w-prose text-sm text-slate-500 dark:text-slate-400">
        Applies the same choice to every instance you just added — change any of it per instance
        later from the Stack page.
      </p>

      <div className="mt-5 flex flex-col gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={vodCacheEnabled}
            onChange={(e) => setVodCacheEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
          />
          Cache VOD locally
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={catchupEnabled}
            onChange={(e) => setCatchupEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
          />
          Buffer live channels for catchup
        </label>
        {catchupEnabled && (
          <label className="ml-6 flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Hours of catchup to keep
            </span>
            <input
              type="number"
              min="1"
              className={`${FIELD} w-32`}
              value={catchupDurationHours}
              onChange={(e) => setCatchupDurationHours(e.target.value)}
            />
          </label>
        )}
      </div>

      {cachingOn && (
        <div className="mt-5 border-t border-slate-200 pt-5 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Where should this stuff live?</h3>
          <label className="mt-3 flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Parent folder on the Docker host
            </span>
            <input
              className={FIELD}
              value={parentPath}
              onChange={(e) => updateParentPath(e.target.value)}
              placeholder="/mnt/user/cache/stream-share-suite"
            />
          </label>

          {parentPath && (
            <div className="mt-3 flex flex-col gap-2">
              {instances.map((instance) => (
                <label key={instance.key} className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    {instance.displayName}
                  </span>
                  <input
                    className={FIELD}
                    value={cachePaths[instance.key] || ""}
                    onChange={(e) => setCachePaths((prev) => ({ ...prev, [instance.key]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mt-4">
          <ErrorNote message={error} />
        </div>
      )}

      <div className="mt-5">
        <Button
          tone="accent"
          onClick={submit}
          loading={saving}
          disabled={saving || !allPathsFilled || (cachingOn && !parentPath)}
        >
          Continue
        </Button>
      </div>
    </Card>
  );
}
