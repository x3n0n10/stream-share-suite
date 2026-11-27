import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import * as f from "./format.js";

// The format helpers bound to the active language; re-renders on a language change.
export function useFormat() {
  const { i18n } = useTranslation();
  const lng = i18n.resolvedLanguage || i18n.language;
  return useMemo(
    () => ({
      formatDuration: (s) => f.formatDuration(s, lng),
      formatRelativeTime: (iso, opts) => f.formatRelativeTime(iso, { ...opts, lng }),
      formatDate: (iso) => f.formatDate(iso, lng),
      formatDateTime: (iso) => f.formatDateTime(iso, lng),
      formatWeekday: (d) => f.formatWeekday(d, lng),
      formatNumber: (n) => f.formatNumber(n, lng),
      formatList: (items) => f.formatList(items, lng),
    }),
    [lng],
  );
}
