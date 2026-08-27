export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

// withTime appends the local time of day (e.g. "yesterday, 19:35") once the
// relative label drops to day/month/year granularity, since at that point
// the label alone no longer conveys what time it happened.
export function formatRelativeTime(isoString, { withTime = false } = {}) {
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
      const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(-value, unit);
      if (withTime && unit !== "hour" && unit !== "minute") {
        const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
        return `${relative}, ${time}`;
      }
      return relative;
    }
  }
  return "just now";
}

export function formatDateTime(isoString) {
  if (!isoString) return "—";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Date only — for values where the time of day is noise, such as a
// subscription's expiry date.
export function formatDate(isoString) {
  if (!isoString) return "—";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatNumber(n) {
  return new Intl.NumberFormat().format(n || 0);
}

export function titleCase(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
