import { useTranslation } from "react-i18next";
import { Select } from "./common.jsx";
import { LANGUAGES } from "../locales/languages.js";

const OPTIONS = LANGUAGES.map(({ code, name }) => ({ value: code, label: name }));

export default function LanguagePicker() {
  const { t, i18n } = useTranslation();
  return (
    <Select
      ariaLabel={t("language.label")}
      value={i18n.resolvedLanguage}
      onChange={(code) => i18n.changeLanguage(code)}
      options={OPTIONS}
    />
  );
}
