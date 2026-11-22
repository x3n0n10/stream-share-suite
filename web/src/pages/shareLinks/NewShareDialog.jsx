import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, ErrorNote, FIELD } from "../../components/common.jsx";
import ChannelSearchInput from "../../components/ChannelSearchInput.jsx";
import { IconCheck, IconCopy } from "../../components/Icons.jsx";
import { api } from "../../lib/api.js";
import { copyToClipboard } from "../../lib/clipboard.js";
import { defaultWindow, toDatetimeLocal, validateWindow } from "../../lib/shareLinks.js";
import { useDelayedUnmount } from "../../lib/useDelayedUnmount.js";
import { errorText } from "../../lib/serverText.js";

const LABEL = "mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400";

// One address of a created link: the full URL with a Copy button, or — when
// the Suite does not know the instance's public address — just the path, with
// Copy disabled rather than handing out an address that would not work.
function AddressRow({ label, hint, url, path }) {
  const { t } = useTranslation();
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
          {copied ? t("common.copied") : t("common.copy")}
        </Button>
      </div>
    </div>
  );
}

// Creates a share link on one instance. Two views: the form, then — once the
// instance has created the link — its addresses.
export default function NewShareDialog({ open, instance, onClose, onCreated }) {
  const { t } = useTranslation();
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
  const windowProblem = from && until ? validateWindow(startsAt, endsAt, Date.now()) : null; // a shareLinks.windowProblem.* suffix
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
      setError(err);
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
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t("shareLinks.dialog.created")}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t("shareLinks.dialog.createdBody", { title: created.title, instance: instance.name })}
            </p>
            <AddressRow
              label={t("shareLinks.dialog.playlistLink")}
              hint={t("shareLinks.dialog.playlistHint")}
              url={created.urls?.playlist}
              path={created.paths.playlist}
            />
            <AddressRow label={t("shareLinks.dialog.streamLink")} hint={t("shareLinks.dialog.streamHint")} url={created.urls?.stream} path={created.paths.stream} />
            {!created.urls && (
              <ErrorNote message={t("shareLinks.dialog.pathsOnly")} />
            )}
            <div className="flex justify-end">
              <Button onClick={finish}>{t("common.close")}</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              {t("shareLinks.dialog.newTitle", { instance: instance.name })}
            </h3>
            <div>
              <label className={LABEL}>{t("shareLinks.dialog.channel")}</label>
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
                placeholder={t("shareLinks.dialog.channelPlaceholder")}
                autoFocus
              />
            </div>
            <div>
              <label className={LABEL}>{t("shareLinks.dialog.guest")}</label>
              <input
                className={FIELD}
                type="text"
                maxLength={40}
                placeholder={t("shareLinks.dialog.guestPlaceholder")}
                value={guest}
                onChange={(e) => setGuest(e.target.value)}
              />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className={LABEL}>{t("shareLinks.dialog.from")}</label>
                <input className={FIELD} type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="flex-1">
                <label className={LABEL}>{t("shareLinks.dialog.until")}</label>
                <input className={FIELD} type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              {t("shareLinks.dialog.limits")}
            </p>
            {windowProblem && <ErrorNote message={t(`shareLinks.windowProblem.${windowProblem}`)} />}
            {error && <ErrorNote message={errorText(error, t)} />}
            <div className="flex justify-end gap-2">
              <Button tone="ghost" onClick={finish}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" loading={saving} disabled={!canSubmit}>
                {t("shareLinks.dialog.create")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
