import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Layout from "../components/Layout.jsx";
import { Card, Badge, StatusDot, EmptyState, RefreshError, Skeleton, TechSummary, RefreshButton, PollStatus } from "../components/common.jsx";
import { SubscriptionSummary } from "../components/Subscription.jsx";
import { IconUsers, IconTag } from "../components/Icons.jsx";
import { api } from "../lib/api.js";
import { usePolling } from "../lib/usePolling.js";
import { streamTypeText } from "../lib/format.js";
import { useFormat } from "../lib/useFormat.js";
import { isAliasableId } from "../lib/aliasing.js";
import { sortNowPlaying } from "../lib/nowPlaying.js";
import { failoverNote } from "../lib/failover.js";

// stream-share instances running the IP-alias feature return viewers as
// {id, display_name} objects instead of plain username/IP strings — support
// both so this keeps working against older instances too.
function viewerId(v) {
  return typeof v === "string" ? v : v.id;
}
function viewerLabel(v) {
  return typeof v === "string" ? v : v.display_name || v.id;
}
function isAliasable(v) {
  return isAliasableId(viewerId(v), viewerLabel(v));
}

export default function Overview({ pollIntervalMs }) {
  const { t } = useTranslation();
  const { formatDuration } = useFormat();
  const { data, error, loading, updatedAt, refresh } = usePolling(() => api.overview(), pollIntervalMs);

  const instances = data?.instances || [];

  const nowPlaying = sortNowPlaying(
    instances.flatMap((i) =>
      (i.status?.summary || []).map((s) => ({ ...s, instanceName: i.name, instanceId: i.id }))
    )
  );

  return (
    <Layout
      title={t("nav.overview")}
      headerExtra={<RefreshButton onClick={refresh} />}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <PollStatus updatedAt={updatedAt} />
        {error && <RefreshError error={error} />}
      </div>

      {loading && !data ? (
        <PageSkeleton />
      ) : (
        <>
          <section>
            <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">{t("overview.nowPlaying")}</h2>
            {nowPlaying.length === 0 ? (
              <EmptyState title={t("overview.nothingPlaying")} subtitle={t("overview.nothingPlayingHint")} />
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">{t("common.title")}</th>
                        <th className="px-4 py-2.5 font-medium">{t("common.instance")}</th>
                        <th className="px-4 py-2.5 font-medium">{t("common.type")}</th>
                        <th className="px-4 py-2.5 font-medium">{t("common.viewers")}</th>
                        <th className="px-4 py-2.5 font-medium">{t("common.since")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {nowPlaying.map((s, idx) => (
                        <tr key={`${s.instanceId}-${s.stream_id}-${idx}`}>
                          <td className={`max-w-[16rem] px-4 py-2.5${s.via ? " shadow-[inset_3px_0_0_theme(colors.amber.500)]" : ""}`}>
                            <p className="truncate font-medium text-slate-800 dark:text-slate-100">
                              {s.stream_title || s.stream_id}
                              {s.epg_channel_id && (
                                <span className="ml-1.5 text-xs font-normal text-slate-400 dark:text-slate-500">
                                  {s.epg_channel_id}
                                </span>
                              )}
                            </p>
                            {s.via && (
                              <p className="text-xs text-amber-600 dark:text-amber-400">{failoverNote(s, true, t)}</p>
                            )}
                            <TechSummary tech={s.tech} className="truncate" />
                          </td>
                          <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{s.instanceName}</td>
                          <td className="px-4 py-2.5">
                            <Badge tone="slate">{streamTypeText(t, s.stream_type)}</Badge>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="flex items-center gap-1 font-medium">
                              <IconUsers className="h-3.5 w-3.5 text-slate-400" />
                              {s.viewer_count}
                            </span>
                            {s.viewers?.length > 0 && (
                              <div className="mt-1 flex max-w-[10rem] flex-wrap gap-1">
                                {s.viewers.map((v) =>
                                  isAliasable(v) ? (
                                    <Link
                                      key={viewerId(v)}
                                      to={`/aliases?ip=${encodeURIComponent(viewerId(v))}`}
                                      title={t("common.addAliasFor", { ip: viewerId(v) })}
                                      className="flex items-center gap-0.5 rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[11px] text-slate-500 hover:border-accent-400 hover:text-accent-600 dark:border-slate-600 dark:text-slate-400 dark:hover:border-accent-500 dark:hover:text-accent-400"
                                    >
                                      {viewerLabel(v)}
                                      <IconTag className="h-2.5 w-2.5" />
                                    </Link>
                                  ) : (
                                    <span
                                      key={viewerId(v)}
                                      className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                                    >
                                      {viewerLabel(v)}
                                    </span>
                                  )
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{s.duration}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </section>

          <section className="mt-8">
            <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">{t("nav.instances")}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {instances.map((i) => (
                <Card key={i.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <StatusDot online={i.online} />
                      <span className="truncate font-medium text-slate-900 dark:text-white">{i.name}</span>
                    </div>
                    <Badge tone={i.online ? "green" : "rose"}>{i.online ? t("common.online") : t("common.offline")}</Badge>
                  </div>
                  {i.online ? (
                    <>
                      <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-sm">
                        <dt className="text-slate-400">{t("overview.streams")}</dt>
                        <dd className="text-right font-medium text-slate-700 dark:text-slate-200">
                          {i.stats?.active_streams ?? i.status?.streams_count ?? 0}
                        </dd>
                        <dt className="text-slate-400">{t("common.viewers")}</dt>
                        <dd className="text-right font-medium text-slate-700 dark:text-slate-200">
                          {i.stats?.active_viewers ?? i.status?.users_count_active ?? 0}
                        </dd>
                        <dt className="text-slate-400">{t("common.uptime")}</dt>
                        <dd className="text-right font-medium text-slate-700 dark:text-slate-200">
                          {i.instance ? formatDuration(i.instance.uptime_seconds) : "—"}
                        </dd>
                      </dl>
                      {/* Renders nothing for instances with no Xtream provider,
                          or running a stream-share without the endpoint. */}
                      <SubscriptionSummary provider={i.provider} />
                    </>
                  ) : (
                    <p className="mt-3 text-xs text-rose-500 dark:text-rose-400">{i.error || t("common.unreachable")}</p>
                  )}
                </Card>
              ))}
            </div>
          </section>
        </>
      )}
    </Layout>
  );
}

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <Skeleton className="h-40" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    </div>
  );
}
