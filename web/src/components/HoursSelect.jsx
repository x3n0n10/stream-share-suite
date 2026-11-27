import { useTranslation } from "react-i18next";
import { Select } from "./common.jsx";

const HOURS_OPTIONS = [
  { value: "1", labelKey: "common.hours.last1" },
  { value: "24", labelKey: "common.hours.last24" },
  { value: "168", labelKey: "common.hours.last168" },
  { value: "720", labelKey: "common.hours.last720" },
  { value: "0", labelKey: "common.hours.all" },
];

export default function HoursSelect({ hours, onChange }) {
  const { t } = useTranslation();
  const options = HOURS_OPTIONS.map(({ value, labelKey }) => ({ value, label: t(labelKey) }));
  return <Select value={String(hours)} onChange={(v) => onChange(Number(v))} options={options} />;
}
