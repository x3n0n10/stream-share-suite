import { Select } from "./common.jsx";

export const HOURS_OPTIONS = [
  { value: "1", label: "Last hour" },
  { value: "24", label: "Last 24h" },
  { value: "168", label: "Last 7 days" },
  { value: "720", label: "Last 30 days" },
  { value: "0", label: "All time" },
];

export default function HoursSelect({ hours, onChange }) {
  return <Select value={String(hours)} onChange={(v) => onChange(Number(v))} options={HOURS_OPTIONS} />;
}
