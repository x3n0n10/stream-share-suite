import { useTranslation } from "react-i18next";
import { Badge } from "./common.jsx";
import { IconAlert } from "./Icons.jsx";
import { connectionUsage } from "../lib/connections.js";
import { useFormat } from "../lib/useFormat.js";

// Renders the upstream IPTV provider's own view of an instance's subscription,
// from stream-share's /api/internal/provider.
//
// Everything here degrades to null rather than to an error or a zero: an
// instance running an older stream-share, or one proxying a plain M3U, simply
// has no subscription to show, and a provider that reports no connection limit
// is not the same as one reporting a limit of zero.

// hasSubscription reports whether there is anything worth rendering.
export function hasSubscription(provider) {
  return !!provider && provider.configured !== false;
}

// Status label + tone. The label always carries the meaning in words — color is
// only ever a second channel on top of it.
function statusOf(provider, t) {
  if (provider.authenticated === false) {
    return { label: t("subscription.status.rejected"), tone: "rose", note: t("subscription.rejectedNote") };
  }
  if (provider.expired) {
    return { label: t("subscription.status.expired"), tone: "rose", note: null };
  }
  if (!provider.active) {
    // The provider's own wording for anything that isn't plainly active
    // ("Banned", "Disabled", …) beats us inventing a synonym for it.
    return { label: provider.status || t("subscription.status.inactive"), tone: "rose", note: null };
  }
  const days = provider.days_remaining;
  if (typeof days === "number" && days <= 7) {
    return { label: provider.status || t("subscription.status.active"), tone: "amber", note: null };
  }
  return { label: provider.status || t("subscription.status.active"), tone: "green", note: null };
}

// Expiry in words: "85 days left", "Expires today", "Expired 3 days ago", or
// the absence of an expiry date, which is a real state and not missing data.
function expiryText(provider, fmt, t) {
  if (provider.expired) {
    return provider.expires_at
      ? t("subscription.expiry.expiredAgo", { when: fmt.formatRelativeTime(provider.expires_at) })
      : t("subscription.expiry.expired");
  }
  if (!provider.expires_at) return t("subscription.expiry.none");

  const days = provider.days_remaining;
  const on = fmt.formatDate(provider.expires_at);
  if (typeof days !== "number") return t("subscription.expiry.on", { date: on });
  if (days <= 0) return t("subscription.expiry.today", { date: on });
  return t("subscription.expiry.daysLeft", { count: days, date: on });
}

// The same facts split into a short value and a muted second line, for the
// Instances page's narrow columns where the one-liner above would wrap.
function expiryParts(provider, fmt, t) {
  if (provider.expired) {
    return {
      value: t("subscription.expiry.expired"),
      sub: provider.expires_at ? fmt.formatRelativeTime(provider.expires_at) : null,
    };
  }
  if (!provider.expires_at) return { value: t("subscription.expiryParts.none"), sub: null };

  const days = provider.days_remaining;
  const on = fmt.formatDate(provider.expires_at);
  if (typeof days !== "number") return { value: on, sub: null };
  if (days <= 0) return { value: t("subscription.expiryParts.today"), sub: on };
  return { value: t("subscription.expiryParts.daysLeft", { count: days }), sub: on };
}

// Connection usage as words. The meter below repeats this visually; the words
// are what actually carry it.
function connectionsText(provider, t) {
  const { used, here, max } = connectionUsage(provider);

  const total = max
    ? t("subscription.connections.ofMax", { used, count: max })
    : t("subscription.connections.noMax", { count: used });
  return here !== null ? t("subscription.connections.withHere", { total, here }) : total;
}

// Meter ramps. Each is one hue in three steps — track, and two fill shades far
// enough apart to stay distinguishable under colorblindness (verified rather
// than eyeballed). Written out in full because Tailwind only ships class names
// it can find literally in the source.
const METER_RAMPS = {
  accent: {
    track: "bg-accent-100 dark:bg-accent-900/50",
    strong: "bg-accent-600 dark:bg-accent-500",
    soft: "bg-accent-300 dark:bg-accent-200",
  },
  amber: {
    track: "bg-amber-100 dark:bg-amber-900/50",
    strong: "bg-amber-600 dark:bg-amber-500",
    soft: "bg-amber-300 dark:bg-amber-200",
  },
  rose: {
    track: "bg-rose-100 dark:bg-rose-900/50",
    strong: "bg-rose-600 dark:bg-rose-500",
    soft: "bg-rose-300 dark:bg-rose-200",
  },
  // An inactive subscription's allowance is moot — show it, but don't dress it
  // up in a color that implies the connections mean anything right now.
  neutral: {
    track: "bg-slate-100 dark:bg-slate-800",
    strong: "bg-slate-400 dark:bg-slate-500",
    soft: "bg-slate-300 dark:bg-slate-700",
  },
};

// A meter, not a chart: one ratio against a limit. The fill carries severity
// and the track is a lighter step of the same ramp, so the state reads across
// the whole bar. Its two segments are shades of one hue — this instance's
// connections against everything else on the account — because they measure the
// same thing; the caption beneath names both, so hue is never the only channel.
function ConnectionMeter({ provider }) {
  const { t } = useTranslation();
  const { used, here: liveHere, max } = connectionUsage(provider);
  if (!max) return null;

  const here = liveHere ?? 0;
  const elsewhere = used - here;

  const ramp =
    METER_RAMPS[
      !provider.active ? "neutral" : used > max ? "rose" : used >= max ? "amber" : "accent"
    ];

  // Over the limit the bar is full and the caption carries the overshoot.
  const pct = (n) => `${Math.min(100, (n / Math.max(max, used)) * 100)}%`;

  return (
    <div
      className={`mt-2 flex h-1.5 gap-[2px] overflow-hidden rounded-full ${ramp.track}`}
      role="meter"
      aria-valuenow={used}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={t("subscription.connections.meter")}
    >
      {here > 0 && <span className={`${ramp.strong} rounded-full`} style={{ width: pct(here) }} />}
      {elsewhere > 0 && <span className={`${ramp.soft} rounded-full`} style={{ width: pct(elsewhere) }} />}
    </div>
  );
}

// One labelled fact, with an optional muted second line so a long value (a
// date, a breakdown) doesn't have to fight for the column's width.
function Fact({ label, value, sub }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="truncate font-medium text-slate-700 dark:text-slate-200">{value}</dd>
      {sub && <dd className="truncate text-xs text-slate-400 dark:text-slate-500">{sub}</dd>}
    </div>
  );
}

// Compact block for the Overview page's instance cards: state, expiry, and how
// much of the connection allowance is spoken for.
export function SubscriptionSummary({ provider }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  if (!hasSubscription(provider)) return null;
  const state = statusOf(provider, t);

  return (
    <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
          {t("subscription.title")}
        </span>
        <div className="flex items-center gap-1.5">
          {provider.is_trial && <Badge tone="slate">{t("subscription.trial")}</Badge>}
          <Badge tone={state.tone}>{state.label}</Badge>
        </div>
      </div>

      <p className="mt-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">{expiryText(provider, fmt, t)}</p>

      <ConnectionMeter provider={provider} />
      <p
        className="mt-1.5 text-xs text-slate-500 dark:text-slate-400"
        title={
          provider.checked_at
            ? t("subscription.checkedTitle", { when: fmt.formatRelativeTime(provider.checked_at) })
            : undefined
        }
      >
        {connectionsText(provider, t)}
      </p>

      {(state.note || provider.stale) && (
        <p className="mt-1.5 flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400">
          <IconAlert className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            {state.note ||
              t(provider.error ? "subscription.lastReadError" : "subscription.lastRead", {
                when: fmt.formatRelativeTime(provider.checked_at),
                error: provider.error,
              })}
          </span>
        </p>
      )}
    </div>
  );
}

// Fuller block for the Instances page, which has the room for the details the
// Overview card leaves out.
export function SubscriptionDetail({ provider }) {
  const { t } = useTranslation();
  const fmt = useFormat();
  if (!hasSubscription(provider)) return null;
  const state = statusOf(provider, t);
  const { used, here, max } = connectionUsage(provider);

  return (
    <div className="mt-4 rounded-xl border border-slate-200/70 p-3 dark:border-slate-800">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
          {t("subscription.providerTitle")}
        </span>
        <div className="flex items-center gap-1.5">
          {provider.is_trial && <Badge tone="slate">{t("subscription.trial")}</Badge>}
          <Badge tone={state.tone}>{state.label}</Badge>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
        <Fact label={t("subscription.facts.expires")} {...expiryParts(provider, fmt, t)} />
        <Fact
          label={t("subscription.facts.connections")}
          value={max ? t("subscription.connections.usedOfMax", { used, max }) : String(used)}
          sub={here !== null ? t("subscription.connections.fromInstance", { here }) : null}
        />
        <Fact label={t("subscription.facts.checked")} value={provider.checked_at ? fmt.formatRelativeTime(provider.checked_at) : "—"} />
      </dl>

      <ConnectionMeter provider={provider} />

      {provider.message && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">“{provider.message}”</p>
      )}
      {(state.note || provider.stale) && (
        <p className="mt-2 flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400">
          <IconAlert className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            {state.note ||
              t(provider.error ? "subscription.lastGoodError" : "subscription.lastGood", { error: provider.error })}
          </span>
        </p>
      )}
    </div>
  );
}
