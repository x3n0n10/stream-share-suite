import { useEffect, useState } from "react";
import { Card, Button, ErrorNote, OnOffToggle } from "../../components/common.jsx";
import ChannelSearchInput from "../../components/ChannelSearchInput.jsx";
import ListInput from "../../components/ListInput.jsx";
import { api } from "../../lib/api.js";
import { describeFailures } from "../../lib/applyToAll.js";
import { useTranslation } from "react-i18next";
import { errorText } from "../../lib/serverText.js";

export default function StepHealthCheck({ instances, onNext, onBack }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(null); // null until seeded; then key -> bool
  const [streamIds, setStreamIds] = useState({}); // key -> string
  const [checkTimes, setCheckTimes] = useState(null); // null until seeded
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function setStreamId(key, value) {
    setStreamIds((prev) => ({ ...prev, [key]: value }));
  }

  useEffect(() => {
    Promise.all(instances.map((i) => api.componentFields("instance", i.key))).then((results) => {
      const seededSelected = {};
      const seededStreamIds = {};
      results.forEach((res, idx) => {
        const byFieldKey = Object.fromEntries(res.fields.map((f) => [f.key, f]));
        const key = instances[idx].key;
        seededSelected[key] = byFieldKey.healthCheckEnabled?.value === "true";
        seededStreamIds[key] = byFieldKey.healthCheckStreamId?.value || "";
      });
      setSelected(seededSelected);
      setStreamIds(seededStreamIds);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.watchdogSettings().then((s) => setCheckTimes(s.checkTimes));
  }, []);

  function toggle(key, value) {
    setSelected((prev) => ({ ...prev, [key]: value }));
  }

  const loaded = selected !== null && checkTimes !== null;
  const chosen = loaded ? instances.filter((i) => selected[i.key]) : [];
  const allStreamIdsFilled = chosen.every((i) => (streamIds[i.key] || "").trim());

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      // Patch every instance, not just the chosen ones — an instance the
      // user just unchecked still needs healthCheckEnabled: false sent, or
      // turning health checks back off would never actually persist.
      const results = await Promise.allSettled(
        instances.map((i) =>
          api.updateStackInstance(i.key, {
            healthCheckEnabled: selected[i.key] ? "true" : "false",
            ...(selected[i.key] ? { healthCheckStreamId: streamIds[i.key] } : {}),
          })
        )
      );
      const failureMessage = describeFailures(
        instances.map((i) => ({ name: i.displayName })),
        results,
        t
      );
      if (failureMessage) {
        setError(failureMessage);
        return;
      }
      await api.saveWatchdogSettings(
        chosen.length > 0 ? { enabled: true, checkTimes } : { enabled: false }
      );
      onNext("done");
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return (
      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t("setup.steps.health")}</h2>
        <p className="mt-5 text-sm text-slate-400">{t("common.loading")}</p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t("setup.steps.health")}</h2>
      <p className="mt-1.5 max-w-prose text-sm text-slate-500 dark:text-slate-400">
        {t("setup.health.intro")}
      </p>

      <div className="mt-5 flex flex-col gap-2">
        {instances.map((instance) => (
          <div key={instance.key} className="flex items-center justify-between gap-3">
            <span className="text-sm text-slate-700 dark:text-slate-300">{instance.displayName}</span>
            <OnOffToggle
              value={!!selected[instance.key]}
              onChange={(value) => toggle(instance.key, value)}
            />
          </div>
        ))}
      </div>

      {chosen.length > 0 && (
        <div className="mt-5 border-t border-slate-200 pt-5 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t("setup.health.probeTitle")}</h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t("setup.health.probeHelp")}
          </p>
          <div className="mt-3 flex flex-col gap-3">
            {chosen.map((instance) => (
              // A <div>, not <label> — ChannelSearchInput is more than one
              // control (input + dropdown + caption), and some browsers
              // (Safari) paint a hover highlight across a whole label's box
              // when any wrapped control is hovered (same reasoning as
              // SchemaForm.jsx's FieldInput).
              <div key={instance.key} className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  {t("setup.health.streamId", { name: instance.displayName })}
                </span>
                <ChannelSearchInput
                  instanceKey={instance.key}
                  value={streamIds[instance.key] || ""}
                  onChange={(value) => setStreamId(instance.key, value)}
                  placeholder="12345.ts"
                />
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
              {t("setup.health.checkTimes")}
            </span>
            <ListInput value={checkTimes} onChange={setCheckTimes} itemType="time" sort ariaLabel={t("setup.health.checkTimesLabel")} />
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4">
          <ErrorNote message={error} />
        </div>
      )}

      <div className="mt-5 flex items-center gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
        {onBack && (
          <Button tone="ghost" onClick={onBack}>
            {t("common.back")}
          </Button>
        )}
        <div className="ml-auto">
          <Button
            tone="accent"
            onClick={submit}
            loading={saving}
            disabled={saving || (chosen.length > 0 && !allStreamIdsFilled)}
          >
            {chosen.length > 0 ? t("common.continue") : t("setup.health.skip")}
          </Button>
        </div>
      </div>
    </Card>
  );
}
