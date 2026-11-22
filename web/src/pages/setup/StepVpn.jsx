import { useEffect, useState } from "react";
import { Card, Button, ErrorNote, OnOffToggle } from "../../components/common.jsx";
import SchemaForm from "../../components/SchemaForm.jsx";
import { api } from "../../lib/api.js";
import { Trans, useTranslation } from "react-i18next";
import { errorText } from "../../lib/serverText.js";

export default function StepVpn({ onNext, onBack }) {
  const { t } = useTranslation();
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
      setError(errorText(err, t));
    }
  }

  async function saveGluetun(patch) {
    setSaving(true);
    setError(null);
    try {
      await api.saveComponent("gluetun", patch);
      onNext("health");
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setSaving(false);
    }
  }

  if (vpnEnabled === null) {
    return (
      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t("setup.steps.vpn")}</h2>
        <p className="mt-5 text-sm text-slate-400">{t("common.loading")}</p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t("setup.vpn.title")}</h2>
      <p className="mt-1.5 max-w-prose text-sm text-slate-500 dark:text-slate-400">
        <Trans
          i18nKey="setup.vpn.intro"
          components={{
            wiki: (
              <a
                href="https://github.com/qdm12/gluetun-wiki"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline"
              />
            ),
          }}
        />
      </p>

      {error && !vpnEnabled && (
        <div className="mt-3">
          <ErrorNote message={error} />
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-sm text-slate-700 dark:text-slate-300">{t("setup.vpn.use")}</span>
        <OnOffToggle value={vpnEnabled} onChange={toggleVpn} />
      </div>

      {vpnEnabled ? (
        <div className="mt-5 border-t border-slate-200 pt-5 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t("catalog.gluetun.label")}</h3>
          <p className="mt-1 max-w-prose text-xs text-slate-500 dark:text-slate-400">
            {t("setup.vpn.gluetunHelp")}
          </p>
          <div className="mt-4">
            {fields === null ? (
              <p className="text-sm text-slate-400">{t("common.loading")}</p>
            ) : (
              <SchemaForm
                kind="gluetun"
                fields={fields}
                onSave={saveGluetun}
                saving={saving}
                error={error}
                submitLabel={t("common.continue")}
                secondaryAction={
                  onBack && (
                    <Button tone="ghost" onClick={onBack}>
                      {t("common.back")}
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
              {t("common.back")}
            </Button>
          )}
          <div className="ml-auto">
            <Button tone="accent" onClick={() => onNext("done")}>
              {t("common.continue")}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
