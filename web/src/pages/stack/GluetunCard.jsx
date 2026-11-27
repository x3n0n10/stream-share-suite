// web/src/pages/stack/GluetunCard.jsx
import { useEffect, useState } from "react";
import { Card, Badge, Button, OnOffToggle } from "../../components/common.jsx";
import { IconRefresh } from "../../components/Icons.jsx";
import SchemaForm from "../../components/SchemaForm.jsx";
import { api } from "../../lib/api.js";
import HistoryPanel from "./HistoryPanel.jsx";
import { useTranslation } from "react-i18next";
import { catalogText } from "../../lib/schemaKeys.js";
import { errorText } from "../../lib/serverText.js";

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
  const { t } = useTranslation();
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
      setError(errorText(err, t));
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
        <div className="flex min-w-0 flex-col gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{catalogText(t, component, "label")}</h2>
            <p className="mt-1 max-w-prose text-xs text-slate-500 dark:text-slate-400">
              {catalogText(t, component, "description")}
            </p>
          </div>
          {settings && (
            <OnOffToggle
              value={settings.vpnEnabled}
              disabled={busy}
              onChange={(vpnEnabled) => onSaveSettings({ vpnEnabled })}
            />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!component.active && <Badge tone="slate">{t("stack.card.notInStack")}</Badge>}
          {component.active && (
            <button
              onClick={onPull}
              disabled={busy}
              aria-label={t("stack.card.checkUpdates")}
              title={t("stack.card.checkUpdatesTitle", { name: "Gluetun" })}
              className="rounded-lg p-1.5 text-accent-600 hover:bg-accent-50 disabled:opacity-50 dark:text-accent-400 dark:hover:bg-accent-900/30"
            >
              <IconRefresh className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800">
        {fields === null ? (
          <p className="text-sm text-slate-400">{t("common.loading")}</p>
        ) : (
          <SchemaForm
            kind="gluetun"
            fields={fields}
            onSave={save}
            saving={saving}
            error={error}
            submitLabel={t("stack.card.saveConfiguration")}
          />
        )}

        <HistoryPanel kind={component.kind} busy={busy} onRestored={refreshAfterRestore} />

        {takeoverAvailable && (
          <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
            <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{t("stack.card.takeoverNote")}</p>
            <Button tone="rose" onClick={onApplyTakeover} loading={busy} disabled={busy}>
              {t("stack.card.takeover")}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
