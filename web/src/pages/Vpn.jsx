import { useEffect, useRef, useState } from "react";
import Layout from "../components/Layout.jsx";
import {
  Card,
  StatusDot,
  EmptyState,
  ErrorNote,
  Skeleton,
  Button,
  ConfirmDialog,
} from "../components/common.jsx";
import { IconRefresh, IconShield, IconGlobe } from "../components/Icons.jsx";
import { api } from "../lib/api.js";
import { usePolling } from "../lib/usePolling.js";
import { formatRelativeTime } from "../lib/format.js";

// gluetun's public IP response field names have varied across versions —
// read defensively and fall back to showing the raw JSON so nothing is lost.
function pick(obj, keys) {
  for (const k of keys) {
    if (obj?.[k]) return obj[k];
  }
  return null;
}

// Reconnect's own wait can still hand back a not-quite-ready IP (gluetun
// reporting "running" a beat before its public IP actually re-resolves) —
// checked the same way the display does, so "settling" only clears once
// there's really something to show.
function hasUsableIp(ip) {
  return Boolean(pick(ip, ["public_ip", "ip"]));
}

const SETTLE_TIMEOUT_MS = 20000;

export default function Vpn({ pollIntervalMs }) {
  const [pending, setPending] = useState(null); // "start" | "stop" | "reconnect" | null
  const [settling, setSettling] = useState(false); // reconnect finished; still fast-polling for a real IP
  const settleDeadlineRef = useRef(0);
  const fastPoll = pending === "reconnect" || settling;
  const { data, error, loading, updatedAt, refresh } = usePolling(
    () => api.gluetunStatus(),
    fastPoll ? 1000 : pollIntervalMs,
    []
  );
  const [actionError, setActionError] = useState(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmReconnect, setConfirmReconnect] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const vpnStatus = data?.vpn?.status || null;
  const running = vpnStatus === "running";
  const stopped = vpnStatus === "stopped";
  const anyPending = pending !== null;

  // Once settling, keep re-checking each freshly-polled result: stop as soon
  // as a real IP shows up, or after SETTLE_TIMEOUT_MS if it never does (at
  // which point publicIpError is shown instead — see the Exit IP card).
  useEffect(() => {
    if (!settling) return;
    if (hasUsableIp(data?.publicIp) || Date.now() >= settleDeadlineRef.current) {
      setSettling(false);
    }
  }, [settling, data]);

  async function runAction(action) {
    setActionError(null);
    setPending(action);
    try {
      await (action === "start" ? api.gluetunStart() : api.gluetunStop());
      await refresh();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setPending(null);
      setConfirmStop(false);
    }
  }

  async function reconnect() {
    setActionError(null);
    setPending("reconnect");
    try {
      await api.gluetunReconnect();
    } catch (err) {
      setActionError(err.message);
    } finally {
      await refresh();
      setPending(null);
      setConfirmReconnect(false);
      settleDeadlineRef.current = Date.now() + SETTLE_TIMEOUT_MS;
      setSettling(true);
    }
  }

  const ip = data?.publicIp;
  const ipAddress = pick(ip, ["public_ip", "ip"]);
  const country = pick(ip, ["country"]);
  const city = pick(ip, ["city"]);
  const region = pick(ip, ["region"]);

  return (
    <Layout
      title="VPN"
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
        <Skeleton className="h-56" />
      ) : !data?.enabled ? (
        <EmptyState
          title="Gluetun isn't configured"
          subtitle="Set GLUETUN_URL (e.g. http://gluetun:8000) — and GLUETUN_API_KEY if your control server requires one — in the dashboard's environment to enable this page."
        />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Card className="p-4 sm:p-5">
              <div className="flex items-center gap-2">
                <StatusDot online={running} />
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Connection
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <IconShield className="h-6 w-6 text-slate-400" />
                <p className="text-xl font-semibold text-slate-900 dark:text-white">
                  {running ? "Connected" : stopped ? "Disconnected" : vpnStatus || "Unknown"}
                </p>
                {pending === "reconnect" && (
                  <span className="animate-fade-scale-in rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                    Reconnecting…
                  </span>
                )}
                {settling && (
                  <span className="animate-fade-scale-in rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                    Waiting for exit IP…
                  </span>
                )}
              </div>
              {data.vpnError && <ErrorNote message={data.vpnError} />}

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  tone="green"
                  disabled={running || anyPending}
                  loading={pending === "start"}
                  onClick={() => runAction("start")}
                >
                  Start
                </Button>
                <Button
                  tone="rose"
                  disabled={stopped || anyPending}
                  loading={pending === "stop"}
                  onClick={() => setConfirmStop(true)}
                >
                  Stop
                </Button>
                <Button
                  tone="ghost"
                  disabled={anyPending}
                  loading={pending === "reconnect"}
                  onClick={() => setConfirmReconnect(true)}
                >
                  <IconRefresh className="h-3.5 w-3.5" />
                  Reconnect
                </Button>
              </div>
              <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                Reconnect stops the tunnel, waits for it to confirm, starts it again, and waits for a fresh exit IP —
                the dashboard refreshes every second while it works, and keeps doing so afterward until the exit IP
                card actually has a value.
              </p>
              {actionError && <div className="mt-2"><ErrorNote message={actionError} /></div>}
            </Card>

            <Card className="p-4 sm:p-5">
              <div className="flex items-center gap-2">
                <IconGlobe className="h-4 w-4 text-slate-400" />
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Exit IP
                </span>
              </div>
              {ip ? (
                <>
                  <p className="mt-2 text-xl font-semibold tabular-nums text-slate-900 dark:text-white">
                    {ipAddress || "—"}
                  </p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {[city, region, country].filter(Boolean).join(", ") || "Location unavailable"}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-rose-500 dark:text-rose-400">
                  {data.publicIpError || "Unavailable"}
                </p>
              )}
            </Card>
          </div>

          <button
            onClick={() => setShowRaw((v) => !v)}
            className="text-xs font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          >
            {showRaw ? "Hide" : "Show"} raw gluetun response
          </button>
          <div
            className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
              showRaw ? "mt-3 grid-rows-[1fr]" : "grid-rows-[0fr]"
            }`}
          >
            <div className="overflow-hidden">
              <Card className="overflow-x-auto p-4">
                <pre className="text-xs text-slate-600 dark:text-slate-300">
                  {JSON.stringify({ vpn: data.vpn, publicIp: data.publicIp }, null, 2)}
                </pre>
              </Card>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmStop}
        title="Stop the VPN connection?"
        body="This disconnects gluetun. Any traffic routed through it (e.g. your stream-share instance's outbound connection) will be interrupted or exposed until it's started again."
        confirmLabel="Stop VPN"
        tone="rose"
        onConfirm={() => runAction("stop")}
        onCancel={() => setConfirmStop(false)}
      />

      <ConfirmDialog
        open={confirmReconnect}
        title="Reconnect the VPN?"
        body="This stops and restarts the tunnel, the same as Stop followed by Start. Any traffic routed through it will be interrupted until it comes back up, which can take a while depending on your provider."
        confirmLabel="Reconnect"
        tone="rose"
        onConfirm={() => {
          setConfirmReconnect(false);
          reconnect();
        }}
        onCancel={() => setConfirmReconnect(false)}
      />
    </Layout>
  );
}
