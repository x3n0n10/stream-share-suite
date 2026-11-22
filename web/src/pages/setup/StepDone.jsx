import { useTranslation } from "react-i18next";
import { Card, Button } from "../../components/common.jsx";

export default function StepDone({ navigate, onBack }) {
  const { t } = useTranslation();
  return (
    <Card className="p-6 text-center">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t("setup.done.title")}</h2>
      <p className="mx-auto mt-2 max-w-prose text-sm text-slate-500 dark:text-slate-400">
        {t("setup.done.body")}
      </p>
      <div className="mt-5 flex items-center justify-center gap-2 border-t border-slate-200 pt-5 dark:border-slate-800">
        {onBack && (
          <Button tone="ghost" onClick={onBack}>
            {t("common.back")}
          </Button>
        )}
        <Button tone="accent" onClick={() => navigate("/stack")}>
          {t("setup.done.review")}
        </Button>
      </div>
    </Card>
  );
}
