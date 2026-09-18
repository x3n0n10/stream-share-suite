import { useEffect, useState } from "react";
import { Card, Button, ErrorNote, FIELD, OnOffToggle } from "../../components/common.jsx";
import { api } from "../../lib/api.js";
import { describeFailures } from "../../lib/applyToAll.js";

export default function StepFeatures({ instances, onNext, onBack }) {
  const [byKey, setByKey] = useState(null); // null until seeded
  const [parentPath, setParentPath] = useState("");
  // key -> the last value auto-suggested for it, so typing a new parent path
  // knows whether to re-suggest (untouched) or leave a hand-edited path alone.
  const [suggestedFor, setSuggestedFor] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all(instances.map((i) => api.componentFields("instance", i.key))).then((results) => {
      const seeded = {};
      results.forEach((res, idx) => {
        const values = Object.fromEntries(res.fields.map((f) => [f.key, f.value]));
        seeded[instances[idx].key] = {
          vodCacheEnabled: values.vodCacheEnabled === "true",
          catchupEnabled: values.catchupEnabled === "true",
          catchupDurationHours: values.catchupDurationHours || "4",
          cachePath: values.cachePath || "",
        };
      });
      setByKey(seeded);
    });
    // Runs once, when this step is first shown — the instance list doesn't
    // change while this step is on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function patch(key, fields) {
    setByKey((prev) => ({ ...prev, [key]: { ...prev[key], ...fields } }));
  }

  function updateParentPath(value) {
    setParentPath(value);
    const trimmedRoot = value.replace(/\/+$/, "");
    const suggestions = Object.fromEntries(
      instances.map((i) => [i.key, value ? `${trimmedRoot}/${i.key}` : ""])
    );

    setByKey((prev) => {
      const next = { ...prev };
      for (const instance of instances) {
        const current = prev[instance.key];
        // Only overwrite a path that's still blank or still exactly the
        // previous suggestion — an existing or hand-typed path is left alone.
        if (!current.cachePath || current.cachePath === suggestedFor[instance.key]) {
          next[instance.key] = { ...current, cachePath: suggestions[instance.key] };
        }
      }
      return next;
    });
    setSuggestedFor(suggestions);
  }

  const allPathsFilled =
    byKey !== null &&
    instances.every((i) => {
      const values = byKey[i.key];
      const cachingOn = values.vodCacheEnabled || values.catchupEnabled;
      return !cachingOn || values.cachePath.trim();
    });

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const results = await Promise.allSettled(
        instances.map((i) => {
          const values = byKey[i.key];
          const cachingOn = values.vodCacheEnabled || values.catchupEnabled;
          return api.updateStackInstance(i.key, {
            vodCacheEnabled: values.vodCacheEnabled ? "true" : "false",
            catchupEnabled: values.catchupEnabled ? "true" : "false",
            ...(values.catchupEnabled ? { catchupDurationHours: values.catchupDurationHours } : {}),
            ...(cachingOn ? { cachePath: values.cachePath } : {}),
          });
        })
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

  if (byKey === null) {
    return (
      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Features</h2>
        <p className="mt-5 text-sm text-slate-400">Loading…</p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">Features</h2>
      <p className="mt-1.5 max-w-prose text-sm text-slate-500 dark:text-slate-400">
        Special features offered by StreamShare. Here you can set up stuff like caching and buffering. The
        folder below is where an instance keeps its temporary files: VOD cache and catchup buffers.
      </p>

      <label className="mt-4 flex flex-col gap-1.5">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
          <span className="italic">Helper</span>: you may enter a parent folder on the Docker host here
          which will then be used as the parent folder for instances below. Only instances that don't 
          already have a files path set are affected. Subfolders will be appended automatically.
        </span>
        <input
          className={FIELD}
          value={parentPath}
          onChange={(e) => updateParentPath(e.target.value)}
        />
        <span className="text-[11px] text-slate-400 dark:text-slate-500">
          Enter an absolute path to a folder on the Docker host — for example, a subfolder under the Suite's own
          data folder, if you don't need these on a separate disk.
        </span>
      </label>

      <div className="mt-5 flex flex-col gap-5">
        {instances.map((instance) => {
          const values = byKey[instance.key];
          const cachingOn = values.vodCacheEnabled || values.catchupEnabled;
          return (
            <div
              key={instance.key}
              className="border-t border-slate-200 pt-4 first:border-t-0 first:pt-0 dark:border-slate-800"
            >
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{instance.displayName}</h3>
              <div className="mt-2 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-700 dark:text-slate-300">Cache VOD locally</span>
                  <OnOffToggle
                    value={values.vodCacheEnabled}
                    onChange={(vodCacheEnabled) => patch(instance.key, { vodCacheEnabled })}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-700 dark:text-slate-300">
                    Buffer live channels for catchup
                  </span>
                  <OnOffToggle
                    value={values.catchupEnabled}
                    onChange={(catchupEnabled) => patch(instance.key, { catchupEnabled })}
                  />
                </div>
                {values.catchupEnabled && (
                  <label className="ml-6 flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                      Hours of catchup to keep
                    </span>
                    <input
                      type="number"
                      min="1"
                      className={`${FIELD} w-32`}
                      value={values.catchupDurationHours}
                      onChange={(e) => patch(instance.key, { catchupDurationHours: e.target.value })}
                    />
                  </label>
                )}
              </div>

              {cachingOn && (
                <label className="mt-3 flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Temporary files location on this host
                  </span>
                  <input
                    className={FIELD}
                    value={values.cachePath}
                    onChange={(e) => patch(instance.key, { cachePath: e.target.value })}
                  />
                </label>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="mt-4">
          <ErrorNote message={error} />
        </div>
      )}

      <div className="mt-5 flex items-center gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
        {onBack && (
          <Button tone="ghost" onClick={onBack}>
            Back
          </Button>
        )}
        <div className="ml-auto">
          <Button tone="accent" onClick={submit} loading={saving} disabled={saving || !allPathsFilled}>
            Continue
          </Button>
        </div>
      </div>
    </Card>
  );
}
