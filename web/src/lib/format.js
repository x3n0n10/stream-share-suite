const PRESETS = {
  duration: { style: "narrow" },
  relativeAuto: { numeric: "auto" },
  time: { hour: "2-digit", minute: "2-digit" },
  dateTime: { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
  date: { year: "numeric", month: "short", day: "numeric" },
  number: {},
  list: { type: "conjunction" },
};
const formatters = new Map();
// Cached per (constructor, language, preset): constructing Intl formatters is slow.
function getFormatter(Ctor, lng, preset) {
  const key = `${Ctor.name}|${lng}|${preset}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Ctor(lng, PRESETS[preset]);
    formatters.set(key, f);
  }
  return f;
}

export function formatDuration(totalSeconds, lng = "en") {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = h > 0 ? { hours: h, minutes: m } : m > 0 ? { minutes: m, seconds: sec } : { seconds: sec };
  if (typeof Intl.DurationFormat === "function") {
    return getFormatter(Intl.DurationFormat, lng, "duration").format(parts);
  }
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

// withTime appends the local time of day (e.g. "yesterday, 19:35") once the
// relative label drops to day/month/year granularity, since at that point
// the label alone no longer conveys what time it happened.
export function formatRelativeTime(isoString, { withTime = false, lng = "en" } = {}) {
  if (!isoString) return "—";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "—";
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.round(diffMs / 1000);
  const abs = Math.abs(diffSec);

  const units = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, secs] of units) {
    if (abs >= secs) {
      const value = Math.round(diffSec / secs);
      const relative = getFormatter(Intl.RelativeTimeFormat, lng, "relativeAuto").format(-value, unit);
      if (withTime && unit !== "hour" && unit !== "minute") {
        const time = getFormatter(Intl.DateTimeFormat, lng, "time").format(date);
        return `${relative}, ${time}`;
      }
      return relative;
    }
  }
  return getFormatter(Intl.RelativeTimeFormat, lng, "relativeAuto").format(0, "second");
}

export function formatDateTime(isoString, lng = "en") {
  if (!isoString) return "—";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "—";
  return getFormatter(Intl.DateTimeFormat, lng, "dateTime").format(date);
}

// Date only — for values where the time of day is noise, such as a
// subscription's expiry date.
export function formatDate(isoString, lng = "en") {
  if (!isoString) return "—";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "—";
  return getFormatter(Intl.DateTimeFormat, lng, "date").format(date);
}

export function formatNumber(n, lng = "en") {
  return getFormatter(Intl.NumberFormat, lng, "number").format(n || 0);
}

export function formatList(items, lng = "en") {
  return getFormatter(Intl.ListFormat, lng, "list").format(items);
}

export function titleCase(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
