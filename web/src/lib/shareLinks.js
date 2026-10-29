// Pure logic behind the Share links page: where a link is in its life, how the
// list is ordered, and whether a window is acceptable. Kept apart from the
// page so it can be tested without a browser.

export const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_MS = 2 * 60 * 60 * 1000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// The instance's own rule: revoked first, then by where `now` falls in the
// window [startsAt, endsAt). Recomputed in the browser so a link flips on time
// without waiting for the next poll.
export function shareState(share, now) {
  if (share.revokedAt) return "revoked";
  const t = new Date(now).getTime();
  if (t < new Date(share.startsAt).getTime()) return "scheduled";
  if (t < new Date(share.endsAt).getTime()) return "active";
  return "ended";
}

const ORDER = { active: 0, scheduled: 1, ended: 2, revoked: 2 };

export function sortShares(shares, now) {
  const time = (iso) => new Date(iso).getTime();
  return [...shares].sort((a, b) => {
    const sa = shareState(a, now);
    const sb = shareState(b, now);
    if (ORDER[sa] !== ORDER[sb]) return ORDER[sa] - ORDER[sb];
    // Scheduled: soonest first. Everything else: most recently over first.
    return sa === "scheduled" ? time(a.startsAt) - time(b.startsAt) : time(b.endsAt) - time(a.endsAt);
  });
}

export function defaultWindow(now) {
  const startsAt = new Date(now);
  return { startsAt, endsAt: new Date(startsAt.getTime() + DEFAULT_WINDOW_MS) };
}

// Mirrors the instance's checks so a bad window is caught before the request.
export function validateWindow(startsAt, endsAt, now) {
  const start = startsAt.getTime();
  const end = endsAt.getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return "Pick a start and an end time.";
  if (end <= start) return "The end must be after the start.";
  if (end - start > MAX_WINDOW_MS) return "A share link may last at most 24 hours.";
  if (end <= new Date(now).getTime()) return "The window is already over.";
  return null;
}

const pad = (n) => String(n).padStart(2, "0");

// The value format of <input type="datetime-local">, in local time.
export function toDatetimeLocal(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// "Sat 20:00 to 23:00", or "Sat 22:00 to Sun 01:00" when the end is another
// local day. Weekday names are fixed English so the text does not depend on
// the viewer's locale.
export function formatWindow(startsAt, endsAt) {
  const clock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = startsAt.toDateString() === endsAt.toDateString();
  const end = sameDay ? clock(endsAt) : `${WEEKDAYS[endsAt.getDay()]} ${clock(endsAt)}`;
  return `${WEEKDAYS[startsAt.getDay()]} ${clock(startsAt)} to ${end}`;
}
