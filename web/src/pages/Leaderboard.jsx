import { useState } from "react";
import { useTranslation } from "react-i18next";
import Layout from "../components/Layout.jsx";
import HoursSelect from "../components/HoursSelect.jsx";
import { Card, Badge, EmptyState, ErrorNote, RefreshError, Skeleton, RefreshButton, PollStatus } from "../components/common.jsx";
import { api } from "../lib/api.js";
import { usePolling } from "../lib/usePolling.js";
import { streamTypeText } from "../lib/format.js";
import { useFormat } from "../lib/useFormat.js";

function BarRow({ primary, secondary, meta, value, max }) {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <div className="py-2.5">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{primary}</p>
          {secondary && <p className="truncate text-xs text-slate-400">{secondary}</p>}
        </div>
        <div className="shrink-0 text-right text-xs text-slate-500 dark:text-slate-400">{meta}</div>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full rounded-full bg-accent-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function Leaderboard({ pollIntervalMs }) {
  const { t } = useTranslation();
  const { formatDuration, formatNumber } = useFormat();
  const [hours, setHours] = useState(24);
  const { data, error, loading, updatedAt, refresh } = usePolling(
    () => api.leaderboard(hours),
    pollIntervalMs,
    [hours]
  );

  const titles = data?.top_titles || [];
  const users = data?.top_users || [];
  const maxTitleSeconds = Math.max(1, ...titles.map((x) => x.watch_seconds));
  const maxUserSeconds = Math.max(1, ...users.map((u) => u.watch_seconds));

  return (
    <Layout
      title={t("nav.leaderboard")}
      headerExtra={
        <>
          <HoursSelect hours={hours} onChange={setHours} />
          <RefreshButton onClick={refresh} />
        </>
      }
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <PollStatus updatedAt={updatedAt}>{t("leaderboard.summed")}</PollStatus>
        {error && <RefreshError error={error} />}
      </div>

      {loading && !data ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="p-4 sm:p-5">
            <h2 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-300">{t("leaderboard.topTitles")}</h2>
            {titles.length === 0 ? (
              <EmptyState title={t("leaderboard.noData")} />
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {titles.map((title, idx) => (
                  <BarRow
                    key={`${title.stream_type}-${title.stream_title}-${idx}`}
                    primary={title.stream_title}
                    secondary={`${streamTypeText(t, title.stream_type)} · ${title.instances.join(", ")}`}
                    meta={`${formatDuration(title.watch_seconds)} · ${t("leaderboard.views", { count: title.views, formatted: formatNumber(title.views) })}`}
                    value={title.watch_seconds}
                    max={maxTitleSeconds}
                  />
                ))}
              </div>
            )}
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-300">{t("leaderboard.topViewers")}</h2>
            {users.length === 0 ? (
              <EmptyState title={t("leaderboard.noData")} />
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {users.map((u, idx) => (
                  <BarRow
                    key={`${u.username}-${idx}`}
                    primary={u.username}
                    secondary={u.instances.join(", ")}
                    meta={`${formatDuration(u.watch_seconds)} · ${t("leaderboard.sessions", { count: u.sessions, formatted: formatNumber(u.sessions) })}`}
                    value={u.watch_seconds}
                    max={maxUserSeconds}
                  />
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {data?.errors?.length > 0 && (
        <div className="mt-4 space-y-1">
          {data.errors.map((e) => (
            <ErrorNote key={e.instanceId} message={`${e.instanceName}: ${e.error}`} />
          ))}
        </div>
      )}
    </Layout>
  );
}
