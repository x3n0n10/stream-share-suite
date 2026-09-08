import { useEffect, useState } from "react";
import { ConfirmDialog } from "../../components/common.jsx";
import { api } from "../../lib/api.js";
import { formatDateTime } from "../../lib/format.js";

// Past versions of one component's stored values, with a restore button per
// entry. Reused by every component card (a singleton, key="") and each
// instance row. Restoring only changes stored config — like any other edit,
// applying the resulting plan is a separate, explicit step.
export default function HistoryPanel({ kind, componentKey = "", busy, onRestored }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (!open || entries) return;
    api.componentHistory(kind, componentKey).then((res) => setEntries(res.history));
  }, [open, entries, kind, componentKey]);

  async function restore(id) {
    setConfirmId(null);
    setRestoring(true);
    try {
      await api.restoreComponentHistory(kind, id, componentKey);
      setEntries(null);
      await onRestored();
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="text-xs font-medium text-accent-600 hover:underline disabled:opacity-50 dark:text-accent-400"
      >
        {open ? "Hide history" : "History"}
      </button>

      {open && (
        <div className="mt-2 rounded-lg border border-slate-200 dark:border-slate-800">
          {entries === null ? (
            <p className="px-3 py-2 text-xs text-slate-400">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
              No earlier versions saved yet.
            </p>
          ) : (
            <ul>
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-xs last:border-b-0 dark:border-slate-800"
                >
                  <span className="text-slate-600 dark:text-slate-300">
                    {formatDateTime(`${entry.created_at.replace(" ", "T")}Z`)}
                  </span>
                  <button
                    onClick={() => setConfirmId(entry.id)}
                    disabled={busy || restoring}
                    className="font-medium text-accent-600 hover:underline disabled:opacity-50 dark:text-accent-400"
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmId !== null}
        title="Restore this version?"
        body="This replaces the currently saved configuration with this earlier one. Nothing is applied to Docker until you Apply."
        confirmLabel="Restore"
        onConfirm={() => restore(confirmId)}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  );
}
