import { useEffect, useState } from "react";
import { Button, ErrorNote, FIELD } from "../../components/common.jsx";
import ChannelSearchInput from "../../components/ChannelSearchInput.jsx";
import { IconCheck, IconCopy } from "../../components/Icons.jsx";
import { api } from "../../lib/api.js";
import { copyToClipboard } from "../../lib/clipboard.js";
import { defaultWindow, toDatetimeLocal, validateWindow } from "../../lib/shareLinks.js";
import { useDelayedUnmount } from "../../lib/useDelayedUnmount.js";

const LABEL = "mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400";

// One address of a created link: the full URL with a Copy button, or — when
// the Suite does not know the instance's public address — just the path, with
// Copy disabled rather than handing out an address that would not work.
function AddressRow({ label, hint, url, path }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await copyToClipboard(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <p className={LABEL}>
        {label} <span className="font-normal text-slate-400">({hint})</span>
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {url || path}
        </code>
        <Button tone="ghost" disabled={!url} onClick={copy}>
          {copied ? <IconCheck className="h-3.5 w-3.5" /> : <IconCopy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

// Creates a share link on one instance. Two views: the form, then — once the
// instance has created the link — its addresses.
export default function NewShareDialog({ open, instance, onClose, onCreated }) {
  const mounted = useDelayedUnmount(open, 150);
  const [channelText, setChannelText] = useState("");
  const [picked, setPicked] = useState(null); // { streamId, name }
  const [guest, setGuest] = useState("");
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);

  // Every opening starts from a clean form with the default window.
  useEffect(() => {
    if (!open) return;
    const w = defaultWindow(Date.now());
    setChannelText("");
    setPicked(null);
    setGuest("");
    setFrom(toDatetimeLocal(w.startsAt));
    setUntil(toDatetimeLocal(w.endsAt));
    setSaving(false);
    setError(null);
    setCreated(null);
  }, [open]);

  if (!mounted) return null;

  const startsAt = new Date(from);
  const endsAt = new Date(until);
  const windowProblem = from && until ? validateWindow(startsAt, endsAt, Date.now()) : null;
  const canSubmit = !!picked && !!from && !!until && !windowProblem;

  async function submit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const share = await api.createShare(instance.id, {
        guest: guest.trim() || undefined,
        streamId: picked.streamId,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      });
      setCreated(share);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // The list refreshes once the dialog is done with, whichever way it closes.
  function finish() {
    if (created) onCreated(created);
    onClose();
  }

  async function searchChannels(query) {
    const { results } = await api.shareChannels(instance.id, query);
    return (results || []).map((r) => ({ id: r.streamId, name: r.name }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity duration-150 ease-out ${
          open ? "opacity-100" : "opacity-0"
        }`}
        onClick={finish}
        aria-hidden="true"
      />
      <div
        className={`relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl transition-[opacity,transform] duration-150 ease-out-smooth motion-reduce:transform-none dark:border-slate-800 dark:bg-slate-900 ${
          open ? "scale-100 opacity-100" : "scale-95 opacity-0"
        }`}
      >
        {created ? (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Link created</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {created.title} on {instance.name}. Share one of these with your guest.
            </p>
            <AddressRow
              label="Playlist link"
              hint="for VLC and IPTV apps"
              url={created.urls?.playlist}
              path={created.paths.playlist}
            />
            <AddressRow label="Stream link" hint="direct" url={created.urls?.stream} path={created.paths.stream} />
            {!created.urls && (
              <ErrorNote message="The Suite does not know this instance's public address, so these are paths only. Add your public address in front of them." />
            )}
            <div className="flex justify-end">
              <Button onClick={finish}>Close</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              New share link on {instance.name}
            </h3>
            <div>
              <label className={LABEL}>Channel</label>
              <ChannelSearchInput
                instanceKey={instance.id}
                value={channelText}
                onChange={(text) => {
                  setChannelText(text);
                  setPicked(null);
                }}
                search={searchChannels}
                pickValue={(match) => match.name}
                onPick={(match) => setPicked({ streamId: match.id, name: match.name })}
                placeholder="Search channels, e.g. eurosport"
                autoFocus
              />
            </div>
            <div>
              <label className={LABEL}>Guest (optional label)</label>
              <input
                className={FIELD}
                type="text"
                maxLength={40}
                placeholder="e.g. Uncle Bert"
                value={guest}
                onChange={(e) => setGuest(e.target.value)}
              />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className={LABEL}>From</label>
                <input className={FIELD} type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="flex-1">
                <label className={LABEL}>Until</label>
                <input className={FIELD} type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Longest allowed: 24 hours. Up to 3 devices can use one link at once.
            </p>
            {windowProblem && <ErrorNote message={windowProblem} />}
            {error && <ErrorNote message={error} />}
            <div className="flex justify-end gap-2">
              <Button tone="ghost" onClick={finish}>
                Cancel
              </Button>
              <Button type="submit" loading={saving} disabled={!canSubmit}>
                Create link
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
