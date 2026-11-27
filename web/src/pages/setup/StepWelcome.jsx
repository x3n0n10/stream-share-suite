import { useTranslation } from "react-i18next";
import { Card, Button } from "../../components/common.jsx";

const HIGHLIGHTS = ["instances", "caching", "external", "vpn", "health"];

export default function StepWelcome({ onNext }) {
  const { t } = useTranslation();
  return (
    <Card className="p-6 text-center">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t("setup.welcome.title")}</h2>
      <p className="mx-auto mt-2 max-w-prose text-sm text-slate-500 dark:text-slate-400">
        {t("setup.welcome.intro")}
      </p>

      <ul className="mx-auto mt-5 flex max-w-md flex-col gap-2 text-left text-sm text-slate-600 dark:text-slate-300">
        {HIGHLIGHTS.map((id) => (
          <li key={id} className="flex gap-2">
            <span className="mt-0.5 text-accent-500">•</span>
            <span>{t(`setup.welcome.highlights.${id}`)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-5 flex items-center justify-center gap-2 border-t border-slate-200 pt-5 dark:border-slate-800">
        <Button tone="accent" onClick={() => onNext("portRange")}>
          {t("setup.welcome.start")}
        </Button>
      </div>
    </Card>
  );
}
