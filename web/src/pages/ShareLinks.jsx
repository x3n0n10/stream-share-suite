import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import {
  Card,
  Badge,
  EmptyState,
  ErrorNote,
  Skeleton,
  Button,
  ConfirmDialog,
  RefreshButton,
  PollStatus,
} from "../components/common.jsx";
import { IconCheck, IconCopy, IconTrash } from "../components/Icons.jsx";
import { api } from "../lib/api.js";
import { copyToClipboard } from "../lib/clipboard.js";
import { usePolling } from "../lib/usePolling.js";
import { useConfig } from "../lib/ConfigContext.jsx";
import { failedPoll, formatWindow, shareState, sortShares } from "../lib/shareLinks.js";
import NewShareDialog from "./shareLinks/NewShareDialog.jsx";

const STATE_TONE = { active: "green", scheduled: "amber", ended: "slate", revoked: "slate" };

// An instance from before share links answers "not supported"; that is a state
// of the page, not a failure, so it is carried in the data instead of thrown.
async function loadShares(instanceId) {
  try {
    return { instanceId, ...(await api.shares(instanceId)) };
  } catch (err) {
    if (err.body?.code === "shares_unsupported") return { instanceId, unsupported: true, shares: [] };
    throw err;
  }
}

export default function ShareLinks({ pollIntervalMs }) {
  const config = useConfig();
  const instances = config?.instances || [];

  const [selectedId, setSelectedId] = useState("");
  const instance = instances.find((i) => i.id === selectedId) || instances[0];
  const instanceId = instance?.id;

  const [now, setNow] = useState(() => Date.now());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [revoking, setRevoking] = useState(null); // the share awaiting confirmation
  const [actionError, setActionError] = useState(null);
  const [copied, setCopied] = useState(""); // `${token}:${kind}` shown as copied

  // A failed poll comes back as data of its own instance (failedPoll), never as
  // a thrown error, so a slow answer for the instance just left cannot put its
  // error — or its "finished loading" — on the tab now showing.
  const lastGood = useRef(null);
  const { data, updatedAt, refresh } = usePolling(
    async () => {
      try {
        lastGood.current = await loadShares(instanceId);
        return lastGood.current;
      } catch (err) {
        return failedPoll(instanceId, err.message, lastGood.current);
      }
    },
    pollIntervalMs,
    [instanceId]
  );
  // Data of the instance that was selected before a switch must not linger.
  const current = data?.instanceId === instanceId ? data : null;

  // A link flips between scheduled, active and ended by the clock alone, so the
  // state is recomputed here instead of waiting for the next poll.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const rows = useMemo(() => sortShares(current?.shares || [], now), [current, now]);
  const unsupported = !!current?.unsupported;

  async function copy(share, kind) {
    await copyToClipboard(share.urls[kind]);
    const key = `${share.token}:${kind}`;
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? "" : c)), 2000);
  }

  async function revoke() {
    const share = revoking;
    setRevoking(null);
    setActionError(null);
    try {
      await api.revokeShare(instanceId, share.token);
      refresh();
    } catch (err) {
      setActionError(err.message);
    }
  }

  return (
    <Layout title="Share links" headerExtra={<RefreshButton onClick={refresh} />}>
      <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
        Need a movie or episode link? Use{" "}
        <Link to="/vod" className="text-accent-600 hover:underline dark:text-accent-400">
          VOD search
        </Link>
        .
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {instances.length > 1 &&
            instances.map((i) => (
              <button
                key={i.id}
                type="button"
                onClick={() => setSelectedId(i.id)}
                className={`rounded-full px-3 py-1 text-sm font-medium ${
                  i.id === instanceId
                    ? "bg-accent-600 text-white"
                    : "border border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                {i.name}
              </button>
            ))}
        </div>
        {!unsupported && instance && <Button onClick={() => setDialogOpen(true)}>+ New link</Button>}
      </div>

      {current?.error && (
        <div className="mt-3">
          <ErrorNote message={`Refresh failed: ${current.error}`} />
        </div>
      )}
      {actionError && (
        <div className="mt-3">
          <ErrorNote message={actionError} />
        </div>
      )}
      {current && !unsupported && current.publicBaseUrl === null && (
        <div className="mt-3">
          <ErrorNote message="The Suite does not know this instance's public address, so it cannot build copyable links. Set the public base URL on the instance (Stack page) to enable Copy." />
        </div>
      )}

      <div className="mt-4">
        {!current ? (
          <Skeleton className="h-48" />
        ) : unsupported ? (
          <EmptyState
            title="This instance does not support share links"
            subtitle="Update it to a newer image and reload."
          />
        ) : rows.length === 0 && current.error ? null : rows.length === 0 ? (
          <EmptyState title="No share links yet" subtitle="Create one for a guest to watch a channel for a while." />
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Channel</th>
                  <th className="px-4 py-3 font-medium">For</th>
                  <th className="px-4 py-3 font-medium">Window</th>
                  <th className="px-4 py-3 font-medium">State</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((share) => {
                  const state = shareState(share, now);
                  const live = state === "active" || state === "scheduled";
                  return (
                    <tr
                      key={share.token}
                      className={`border-t border-slate-100 dark:border-slate-800 ${live ? "" : "opacity-60"}`}
                    >
                      <td className="max-w-[16rem] truncate px-4 py-3 text-slate-900 dark:text-white">
                        {share.title}
                        <span className="ml-1.5 text-xs text-slate-400">{share.streamId}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{share.guest || "-"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-300">
                        {formatWindow(new Date(share.startsAt), new Date(share.endsAt))}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={STATE_TONE[state]}>{state}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        {live && (
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {share.urls ? (
                              ["playlist", "stream"].map((kind) => (
                                <Button key={kind} tone="ghost" onClick={() => copy(share, kind)}>
                                  {copied === `${share.token}:${kind}` ? (
                                    <IconCheck className="h-3.5 w-3.5" />
                                  ) : (
                                    <IconCopy className="h-3.5 w-3.5" />
                                  )}
                                  {kind === "playlist" ? "Playlist" : "Stream"}
                                </Button>
                              ))
                            ) : (
                              <span className="flex flex-col text-right text-xs text-slate-400">
                                <code>{share.paths.playlist}</code>
                                <code>{share.paths.stream}</code>
                              </span>
                            )}
                            <Button tone="ghost" onClick={() => setRevoking(share)}>
                              <IconTrash className="h-3.5 w-3.5" />
                              Revoke
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </div>
      <PollStatus updatedAt={updatedAt} className="mt-2" />

      {instance && (
        <NewShareDialog
          open={dialogOpen}
          instance={instance}
          onClose={() => setDialogOpen(false)}
          onCreated={refresh}
        />
      )}
      <ConfirmDialog
        open={!!revoking}
        title="Revoke this link?"
        body={revoking ? `${revoking.title}${revoking.guest ? ` for ${revoking.guest}` : ""} stops working immediately.` : ""}
        confirmLabel="Revoke"
        onConfirm={revoke}
        onCancel={() => setRevoking(null)}
      />
    </Layout>
  );
}
