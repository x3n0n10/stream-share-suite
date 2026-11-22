import { useTranslation } from "react-i18next";
import Layout from "../components/Layout.jsx";
import { Card, Badge, StatusDot, ErrorNote, RefreshError, Skeleton, RefreshButton, PollStatus } from "../components/common.jsx";
import { SubscriptionDetail } from "../components/Subscription.jsx";
import { api } from "../lib/api.js";
import { usePolling } from "../lib/usePolling.js";
import { useFormat } from "../lib/useFormat.js";

function FeatureBadge({ on, label }) {
  return <Badge tone={on ? "accent" : "slate"}>{label}</Badge>;
}

export default function Instances({ pollIntervalMs }) {
  const { t } = useTranslation();
  const { formatDuration, formatDateTime } = useFormat();
  const { data, error, loading, updatedAt, refresh } = usePolling(() => api.overview(24), pollIntervalMs, []);

  const instances = data?.instances || [];

  return (
    <Layout
      title={t("nav.instances")}
      headerExtra={
        <RefreshButton onClick={refresh} />
      }
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <PollStatus updatedAt={updatedAt} />
        {error && <RefreshError error={error} />}
      </div>

      {loading && !data ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      ) : instances.length === 0 ? (
        <ErrorNote message={t("instances.none")} />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {instances.map((i) => (
            <Card key={i.id} className="p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <StatusDot online={i.online} />
                  <span className="truncate font-semibold text-slate-900 dark:text-white">{i.name}</span>
                </div>
                <Badge tone={i.online ? "green" : "rose"}>{i.online ? t("common.online") : t("common.offline")}</Badge>
              </div>
              <p className="mt-1 truncate text-xs text-slate-400">{i.url}</p>

              {i.online ? (
                <>
                  <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-xs text-slate-400">{t("common.uptime")}</dt>
                      <dd className="font-medium text-slate-700 dark:text-slate-200">
                        {i.instance ? formatDuration(i.instance.uptime_seconds) : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400">{t("instances.started")}</dt>
                      <dd className="font-medium text-slate-700 dark:text-slate-200">
                        {i.instance ? formatDateTime(i.instance.started_at) : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400">{t("instances.database")}</dt>
                      <dd className="font-medium text-slate-700 dark:text-slate-200">
                        {i.instance?.db_connected ? t("instances.connected") : "—"}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    <FeatureBadge on={i.instance?.discord_enabled} label={t("instances.discord")} />
                    <FeatureBadge on={i.instance?.vod_cache_enabled} label={t("instances.vodCache")} />
                    <FeatureBadge on={i.instance?.catchup_enabled} label={t("instances.catchup")} />
                  </div>
                  {/* Only for Xtream-backed instances; renders nothing otherwise. */}
                  <SubscriptionDetail provider={i.provider} />
                </>
              ) : (
                <p className="mt-4 text-sm text-rose-500 dark:text-rose-400">{i.error || t("common.unreachable")}</p>
              )}
            </Card>
          ))}
        </div>
      )}
    </Layout>
  );
}
