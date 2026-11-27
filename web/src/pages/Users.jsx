import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Layout from "../components/Layout.jsx";
import { Card, Badge, EmptyState, ErrorNote, RefreshError, Skeleton, RefreshButton, PollStatus } from "../components/common.jsx";
import { api } from "../lib/api.js";
import { usePolling } from "../lib/usePolling.js";
import { streamTypeText } from "../lib/format.js";
import { useFormat } from "../lib/useFormat.js";

export default function Users({ pollIntervalMs }) {
  const { t } = useTranslation();
  const { formatDateTime } = useFormat();
  const [search, setSearch] = useState("");
  const { data, error, loading, updatedAt, refresh } = usePolling(() => api.users(), pollIntervalMs, []);

  const users = data?.users || [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.Username?.toLowerCase().includes(q) ||
        u.display_name?.toLowerCase().includes(q) ||
        u.instance_name?.toLowerCase().includes(q) ||
        u.StreamID?.toLowerCase().includes(q)
    );
  }, [users, search]);

  const sorted = [...filtered].sort((a, b) => {
    const aActive = a.StreamID ? 1 : 0;
    const bActive = b.StreamID ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    return new Date(b.LastActive) - new Date(a.LastActive);
  });

  return (
    <Layout
      title={t("nav.users")}
      headerExtra={
        <RefreshButton onClick={refresh} />
      }
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <input
          type="search"
          placeholder={t("users.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-xs rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500 dark:border-slate-700 dark:bg-slate-900"
        />
        <PollStatus updatedAt={updatedAt} />
      </div>

      {error && <RefreshError error={error} />}
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
        ) : sorted.length === 0 ? (
          <EmptyState title={t("users.empty")} subtitle={t("users.emptyHint")} />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 bg-accent-50 text-left text-xs uppercase tracking-wide text-accent-700 dark:border-slate-800 dark:bg-accent-900/20 dark:text-accent-300">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">{t("common.user")}</th>
                    <th className="px-4 py-2.5 font-medium">{t("users.status")}</th>
                    <th className="px-4 py-2.5 font-medium">{t("common.instance")}</th>
                    <th className="px-4 py-2.5 font-medium">{t("users.currentStream")}</th>
                    <th className="px-4 py-2.5 font-medium">{t("users.ip")}</th>
                    <th className="px-4 py-2.5 font-medium">{t("common.since")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 [&>tr:nth-child(even)]:bg-accent-50/50 dark:[&>tr:nth-child(even)]:bg-accent-900/10">
                  {sorted.map((u, idx) => (
                    <tr key={`${u.instance_id}-${u.Username}-${idx}`}>
                      <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-100">
                        {u.display_name || u.Username}
                        {u.DiscordName && (
                          <span className="ml-1.5 text-xs text-slate-400">({u.DiscordName})</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {u.StreamID ? (
                          <Badge tone="green">{t("users.watching")}</Badge>
                        ) : (
                          <Badge tone="slate">{t("users.idle")}</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{u.instance_name}</td>
                      <td className="max-w-[14rem] truncate px-4 py-2.5 text-slate-600 dark:text-slate-300">
                        {u.StreamID ? `${u.StreamID} (${streamTypeText(t, u.StreamType)})` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{u.IPAddress || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-500 dark:text-slate-400">
                        {formatDateTime(u.StartTime)}
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
