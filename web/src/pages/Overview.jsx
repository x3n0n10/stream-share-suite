import { useState } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import HoursSelect from "../components/HoursSelect.jsx";
import { Card, StatTile, Badge, StatusDot, EmptyState, ErrorNote, Skeleton, TechSummary } from "../components/common.jsx";
import { SubscriptionSummary } from "../components/Subscription.jsx";
import { IconOverview, IconPlay, IconUsers, IconHistory, IconRefresh, IconTag } from "../components/Icons.jsx";
import { api } from "../lib/api.js";
import { usePolling } from "../lib/usePolling.js";
import { formatDuration, formatNumber, formatRelativeTime, titleCase } from "../lib/format.js";

// stream-share instances running the IP-alias feature return viewers as
// {id, display_name} objects instead of plain username/IP strings — support
// both so this keeps working against older instances too.
function viewerId(v) {
  return typeof v === "string" ? v : v.id;
}
function viewerLabel(v) {
  return typeof v === "string" ? v : v.display_name || v.id;
}

// A viewer is only ever aliased when LDAP is disabled and the raw client IP
// stands in as their identity (see displayNameFor in stream-share), so only
// offer the "add alias" shortcut for identifiers that actually look like an
// IP address, and only when it doesn't already have one.
const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F]*:[0-9a-fA-F:]*$/;
function isAliasable(v) {
  const id = viewerId(v);
  if (!IP_RE.test(id)) return false;
  return viewerLabel(v) === id;
}

export default function Overview({ pollIntervalMs }) {
  const [hours, setHours] = useState(24);
  const { data, error, loading, updatedAt, refresh } = usePolling(
    () => api.overview(hours),
    pollIntervalMs,
    [hours]
  );

  const instances = data?.instances || [];
  const online = instances.filter((i) => i.online);

  const totals = instances.reduce(
    (acc, i) => {
      acc.activeStreams += i.stats?.active_streams ?? i.status?.streams_count ?? 0;
      acc.activeViewers += i.stats?.active_viewers ?? i.status?.users_count_active ?? 0;
      acc.sessions += i.stats?.sessions ?? 0;
      acc.watchSeconds += i.stats?.watch_seconds ?? 0;
      return acc;
    },
    { activeStreams: 0, activeViewers: 0, sessions: 0, watchSeconds: 0 }
  );

  const nowPlaying = instances
    .flatMap((i) =>
      (i.status?.summary || []).map((s) => ({ ...s, instanceName: i.name, instanceId: i.id }))
    )
    .sort((a, b) => b.viewer_count - a.viewer_count);

  return (
    <Layout
      title="Overview"
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
          {updatedAt ? `Updated ${formatRelativeTime(updatedAt.toISOString())}` : "Loading…"}
        </p>
        {error && <ErrorNote message={`Refresh failed: ${error}`} />}
      </div>

      {loading && !data ? (
        <SkeletonGrid />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatTile
              label="Instances online"
              value={`${online.length}/${instances.length}`}
              icon={IconOverview}
              tone={online.length === instances.length ? "green" : "amber"}
            />
            <StatTile label="Active streams" value={formatNumber(totals.activeStreams)} icon={IconPlay} tone="accent" />
            <StatTile label="Active viewers" value={formatNumber(totals.activeViewers)} icon={IconUsers} tone="default" />
            <StatTile
              label="Watch time (window)"
              value={formatDuration(totals.watchSeconds)}
              sublabel={`${formatNumber(totals.sessions)} sessions`}
              icon={IconHistory}
              tone="default"
            />
          </div>

          <section className="mt-8">
            <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Instances</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {instances.map((i) => (
                <Card key={i.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <StatusDot online={i.online} />
                      <span className="truncate font-medium text-slate-900 dark:text-white">{i.name}</span>
                    </div>
                    <Badge tone={i.online ? "green" : "rose"}>{i.online ? "online" : "offline"}</Badge>
                  </div>
                  {i.online ? (
                    <>
                      <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-sm">
                        <dt className="text-slate-400">Streams</dt>
                        <dd className="text-right font-medium text-slate-700 dark:text-slate-200">
                          {i.stats?.active_streams ?? i.status?.streams_count ?? 0}
                        </dd>
                        <dt className="text-slate-400">Viewers</dt>
                        <dd className="text-right font-medium text-slate-700 dark:text-slate-200">
                          {i.stats?.active_viewers ?? i.status?.users_count_active ?? 0}
                        </dd>
                        <dt className="text-slate-400">Uptime</dt>
                        <dd className="text-right font-medium text-slate-700 dark:text-slate-200">
                          {i.instance ? formatDuration(i.instance.uptime_seconds) : "—"}
                        </dd>
                      </dl>
                      {/* Renders nothing for instances with no Xtream provider,
                          or running a stream-share without the endpoint. */}
                      <SubscriptionSummary provider={i.provider} />
                    </>
                  ) : (
                    <p className="mt-3 text-xs text-rose-500 dark:text-rose-400">{i.error || "Unreachable"}</p>
                  )}
                </Card>
              ))}
            </div>
          </section>

          <section className="mt-8">
            <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Now playing</h2>
            {nowPlaying.length === 0 ? (
              <EmptyState title="Nothing is playing" subtitle="Active streams across every instance will show up here." />
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Title</th>
                        <th className="px-4 py-2.5 font-medium">Instance</th>
                        <th className="px-4 py-2.5 font-medium">Type</th>
                        <th className="px-4 py-2.5 font-medium">Viewers</th>
                        <th className="px-4 py-2.5 font-medium">Since</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {nowPlaying.map((s, idx) => (
                        <tr key={`${s.instanceId}-${s.stream_id}-${idx}`}>
                          <td className="max-w-[16rem] px-4 py-2.5">
                            <p className="truncate font-medium text-slate-800 dark:text-slate-100">
                              {s.stream_title || s.stream_id}
                              {s.epg_channel_id && (
                                <span className="ml-1.5 text-xs font-normal text-slate-400 dark:text-slate-500">
                                  {s.epg_channel_id}
                                </span>
                              )}
                            </p>
                            <TechSummary tech={s.tech} className="truncate" />
                          </td>
                          <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{s.instanceName}</td>
                          <td className="px-4 py-2.5">
                            <Badge tone="slate">{titleCase(s.stream_type)}</Badge>
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
                                      title={`Add an alias for ${viewerId(v)}`}
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
        </>
      )}
    </Layout>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-24" />
      ))}
    </div>
  );
}
