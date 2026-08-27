import { useState } from "react";
import Layout from "../components/Layout.jsx";
import HoursSelect from "../components/HoursSelect.jsx";
import { Card, Badge, EmptyState, ErrorNote, Skeleton } from "../components/common.jsx";
import { IconRefresh } from "../components/Icons.jsx";
import { api } from "../lib/api.js";
import { usePolling } from "../lib/usePolling.js";
import { formatDuration, formatNumber, formatRelativeTime, titleCase } from "../lib/format.js";

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
  const [hours, setHours] = useState(24);
  const { data, error, loading, updatedAt, refresh } = usePolling(
    () => api.leaderboard(hours),
    pollIntervalMs,
    [hours]
  );

  const titles = data?.top_titles || [];
  const users = data?.top_users || [];
  const maxTitleSeconds = Math.max(1, ...titles.map((t) => t.watch_seconds));
  const maxUserSeconds = Math.max(1, ...users.map((u) => u.watch_seconds));

  return (
    <Layout
      title="Leaderboard"
      headerExtra={
        <>
          <HoursSelect hours={hours} onChange={setHours} />
          <button
            onClick={refresh}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="Refresh"
          >
            <IconRefresh className="h-4 w-4" />
          </button>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {updatedAt ? `Updated ${formatRelativeTime(updatedAt.toISOString())}` : "Loading…"} · summed across all
          instances
        </p>
        {error && <ErrorNote message={`Refresh failed: ${error}`} />}
      </div>

      {loading && !data ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="p-4 sm:p-5">
            <h2 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-300">Top titles</h2>
            {titles.length === 0 ? (
              <EmptyState title="No watch data yet" />
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {titles.map((t, idx) => (
                  <BarRow
                    key={`${t.stream_type}-${t.stream_title}-${idx}`}
                    primary={t.stream_title}
                    secondary={`${titleCase(t.stream_type)} · ${t.instances.join(", ")}`}
                    meta={`${formatDuration(t.watch_seconds)} · ${formatNumber(t.views)} views`}
                    value={t.watch_seconds}
                    max={maxTitleSeconds}
                  />
                ))}
              </div>
            )}
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-300">Top viewers</h2>
            {users.length === 0 ? (
              <EmptyState title="No watch data yet" />
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {users.map((u, idx) => (
                  <BarRow
                    key={`${u.username}-${idx}`}
                    primary={u.username}
                    secondary={u.instances.join(", ")}
                    meta={`${formatDuration(u.watch_seconds)} · ${formatNumber(u.sessions)} sessions`}
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
