import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import HoursSelect from "../components/HoursSelect.jsx";
import { Card, Badge, EmptyState, ErrorNote, Skeleton } from "../components/common.jsx";
import { IconRefresh, IconTag } from "../components/Icons.jsx";
import { api } from "../lib/api.js";
import { usePolling } from "../lib/usePolling.js";
import { formatDuration, formatDateTime, formatRelativeTime, titleCase } from "../lib/format.js";
import { isAliasableId } from "../lib/aliasing.js";

export default function History({ pollIntervalMs }) {
  const [hours, setHours] = useState(24);
  const [search, setSearch] = useState("");
  const [relativeTime, setRelativeTime] = useState(
    () => localStorage.getItem("historyWhenFormat") === "relative"
  );

  const toggleWhenFormat = (relative) => {
    setRelativeTime(relative);
    localStorage.setItem("historyWhenFormat", relative ? "relative" : "date");
  };
  const { data, error, loading, updatedAt, refresh } = usePolling(
    () => api.history(hours, 200),
    pollIntervalMs,
    [hours]
  );

  const feed = data?.feed || [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return feed;
    return feed.filter(
      (e) =>
        e.username?.toLowerCase().includes(q) ||
        e.display_name?.toLowerCase().includes(q) ||
        e.stream_title?.toLowerCase().includes(q) ||
        e.instance_name?.toLowerCase().includes(q)
    );
  }, [feed, search]);

  return (
    <Layout
      title="History"
      headerExtra={
        <>
          <HoursSelect hours={hours} onChange={setHours} />
          <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-900">
            <button
              onClick={() => toggleWhenFormat(false)}
              className={`rounded-md px-2 py-1 transition-colors ${
                !relativeTime
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              Date
            </button>
            <button
              onClick={() => toggleWhenFormat(true)}
              className={`rounded-md px-2 py-1 transition-colors ${
                relativeTime
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              Relative
            </button>
          </div>
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
        <input
          type="search"
          placeholder="Search user, title, instance…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-xs rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500 dark:border-slate-700 dark:bg-slate-900"
        />
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {updatedAt ? `Updated ${formatRelativeTime(updatedAt.toISOString())}` : "Loading…"}
        </p>
      </div>

      {error && <ErrorNote message={`Refresh failed: ${error}`} />}
      {data?.errors?.length > 0 && (
        <div className="mt-2 space-y-1">
          {data.errors.map((e) => (
            <ErrorNote key={e.instanceId} message={`${e.instanceName}: ${e.error}`} />
          ))}
        </div>
      )}

      <div className="mt-4">
        {loading && !data ? (
          <Skeleton className="h-96" />
        ) : filtered.length === 0 ? (
          <EmptyState title="No watch history" subtitle="Try a wider time range, or check back once someone starts watching." />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">When</th>
                    <th className="px-4 py-2.5 font-medium">User</th>
                    <th className="px-4 py-2.5 font-medium">Title</th>
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 font-medium">Instance</th>
                    <th className="px-4 py-2.5 font-medium">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filtered.map((e, idx) => (
                    <tr key={`${e.instance_id}-${idx}-${e.start_time}`}>
                      <td
                        className="whitespace-nowrap px-4 py-2.5 text-slate-500 dark:text-slate-400"
                        title={relativeTime ? formatDateTime(e.start_time) : undefined}
                      >
                        {relativeTime
                          ? formatRelativeTime(e.start_time, { withTime: true })
                          : formatDateTime(e.start_time)}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-100">
                        {e.display_name || e.username}
                        {e.display_name && e.display_name !== e.username && (
                          <span className="ml-1.5 text-xs font-normal text-slate-400 dark:text-slate-500">
                            {e.username}
                          </span>
                        )}
                        {isAliasableId(e.username, e.display_name) && (
                          <Link
                            to={`/aliases?ip=${encodeURIComponent(e.username)}`}
                            title={`Add an alias for ${e.username}`}
                            className="ml-1.5 inline-flex items-center align-middle text-slate-400 hover:text-accent-600 dark:text-slate-500 dark:hover:text-accent-400"
                          >
                            <IconTag className="h-3 w-3" />
                          </Link>
                        )}
                      </td>
                      <td className="max-w-[16rem] truncate px-4 py-2.5">{e.stream_title}</td>
                      <td className="px-4 py-2.5">
                        <Badge tone="slate">{titleCase(e.stream_type)}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{e.instance_name}</td>
                      <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">
                        {formatDuration(e.duration_sec)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </Layout>
  );
}
