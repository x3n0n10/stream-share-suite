import { useEffect, useState } from "react";
import { Card, Button } from "../../components/common.jsx";
import SchemaForm from "../../components/SchemaForm.jsx";
import { api } from "../../lib/api.js";
import { useTranslation } from "react-i18next";
import { errorText } from "../../lib/serverText.js";

export default function StepDatabase({ onNext, onBack }) {
  const { t } = useTranslation();
  const [fields, setFields] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.componentFields("postgres").then((r) => setFields(r.fields));
  }, []);

  async function save(patch) {
    setSaving(true);
    setError(null);
    try {
      await api.saveComponent("postgres", patch);
      onNext("access");
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">PostgreSQL</h2>
      <p className="mt-1.5 max-w-prose text-sm text-slate-500 dark:text-slate-400">
        {t("setup.database.intro")}
      </p>
      <div className="mt-5">
        {fields === null ? (
          <p className="text-sm text-slate-400">{t("common.loading")}</p>
        ) : (
          <SchemaForm
            kind="postgres"
            fields={fields}
            onSave={save}
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
    </Card>
  );
}
