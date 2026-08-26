import Layout from "../components/Layout.jsx";
import { Card, Badge, StatusDot, ErrorNote, Skeleton } from "../components/common.jsx";
import { SubscriptionDetail } from "../components/Subscription.jsx";
import { IconRefresh } from "../components/Icons.jsx";
import { api } from "../lib/api.js";
import { usePolling } from "../lib/usePolling.js";
import { formatDuration, formatDateTime, formatRelativeTime } from "../lib/format.js";

function FeatureBadge({ on, label }) {
  return <Badge tone={on ? "accent" : "slate"}>{label}</Badge>;
}

export default function Instances({ pollIntervalMs }) {
  const { data, error, loading, updatedAt, refresh } = usePolling(() => api.overview(24), pollIntervalMs, []);

  const instances = data?.instances || [];

  return (
    <Layout
      title="Instances"
      headerExtra={
        <button
          onClick={refresh}
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          aria-label="Refresh"
        >
          <IconRefresh className="h-4 w-4" />
        </button>
      }
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {updatedAt ? `Updated ${formatRelativeTime(updatedAt.toISOString())}` : "Loading…"}
        </p>
        {error && <ErrorNote message={`Refresh failed: ${error}`} />}
      </div>

      {loading && !data ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : instances.length === 0 ? (
        <ErrorNote message="No instances configured. Set INSTANCE_1_NAME / INSTANCE_1_URL / INSTANCE_1_API_KEY (and _2_, _3_, …) in the dashboard's environment." />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {instances.map((i) => (
            <Card key={i.id} className="p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <StatusDot online={i.online} />
                  <span className="truncate font-semibold text-slate-900 dark:text-white">{i.name}</span>
                </div>
                <Badge tone={i.online ? "green" : "rose"}>{i.online ? "online" : "offline"}</Badge>
              </div>
              <p className="mt-1 truncate text-xs text-slate-400">{i.url}</p>

              {i.online ? (
                <>
                  <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-xs text-slate-400">Uptime</dt>
                      <dd className="font-medium text-slate-700 dark:text-slate-200">
                        {i.instance ? formatDuration(i.instance.uptime_seconds) : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400">Started</dt>
                      <dd className="font-medium text-slate-700 dark:text-slate-200">
                        {i.instance ? formatDateTime(i.instance.started_at) : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400">Database</dt>
                      <dd className="font-medium text-slate-700 dark:text-slate-200">
                        {i.instance?.db_connected ? "connected" : "—"}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    <FeatureBadge on={i.instance?.discord_enabled} label="Discord" />
                    <FeatureBadge on={i.instance?.vod_cache_enabled} label="VOD cache" />
                    <FeatureBadge on={i.instance?.catchup_enabled} label="Catchup" />
                  </div>
                  {/* Only for Xtream-backed instances; renders nothing otherwise. */}
                  <SubscriptionDetail provider={i.provider} />
                </>
              ) : (
                <p className="mt-4 text-sm text-rose-500 dark:text-rose-400">{i.error || "Unreachable"}</p>
              )}
            </Card>
          ))}
        </div>
      )}
    </Layout>
  );
}
