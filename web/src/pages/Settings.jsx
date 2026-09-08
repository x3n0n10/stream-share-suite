import { useEffect, useState } from "react";
import Layout from "../components/Layout.jsx";
import { Button, Card, ConfirmDialog, ErrorNote, FIELD } from "../components/common.jsx";
import { api } from "../lib/api.js";

function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-slate-400 dark:text-slate-500">{hint}</span>}
    </label>
  );
}

function Section({ title, description, children, footer }) {
  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h2>
      {description && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{description}</p>
      )}
      <div className="mt-4 flex flex-col gap-3">{children}</div>
      {footer && <div className="mt-4 flex items-center gap-3">{footer}</div>}
    </Card>
  );
}

export default function Settings({ onConfigChanged }) {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);

  async function reload() {
    try {
      const current = await api.settings();
      setSettings(current);
      onConfigChanged?.();
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveSettings(payload, label) {
    setError(null);
    try {
      await api.saveSettings(payload);
      setSaved(label);
      setTimeout(() => setSaved(null), 2500);
      reload();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Layout title="Settings">
      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}
      {saved && (
        <p className="mb-4 text-xs text-emerald-700 dark:text-emerald-400">{saved} saved.</p>
      )}

      <div className="flex flex-col gap-4">
        {settings && <GeneralSection settings={settings} onSave={saveSettings} />}
        <PasswordSection />
        <BackupSection />
      </div>
    </Layout>
  );
}

function GeneralSection({ settings, onSave }) {
  const [title, setTitle] = useState(settings.general.title);
  const [pollIntervalMs, setPoll] = useState(settings.general.pollIntervalMs);
  const [instanceTimeoutMs, setTimeout_] = useState(settings.general.instanceTimeoutMs);
  const [busy, setBusy] = useState(false);

  return (
    <Section
      title="General"
      description="Applies across every page."
      footer={
        <Button
          tone="accent"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await onSave(
              { general: { title, pollIntervalMs: Number(pollIntervalMs), instanceTimeoutMs: Number(instanceTimeoutMs) } },
              "General settings"
            );
            setBusy(false);
          }}
        >
          Save
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" hint="Shown in the sidebar and the browser tab.">
          <input className={FIELD} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Poll interval (ms)" hint="How often the browser re-polls. Minimum 5000.">
          <input
            className={FIELD}
            type="number"
            value={pollIntervalMs}
            onChange={(e) => setPoll(e.target.value)}
          />
        </Field>
        <Field label="Instance timeout (ms)" hint="How long to wait for one instance before giving up on it.">
          <input
            className={FIELD}
            type="number"
            value={instanceTimeoutMs}
            onChange={(e) => setTimeout_(e.target.value)}
          />
        </Field>
      </div>
    </Section>
  );
}

function BackupSection() {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function restore() {
    setConfirming(false);
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await api.restoreBackup(file);
      setFile(null);
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Backup & restore"
      description="Every credential, instance definition and component setting lives in one file. Download it before a risky change."
    >
      <div>
        <Button tone="default" onClick={() => window.location.assign("/api/backup")}>
          Download backup
        </Button>
      </div>

      <div className="mt-2 border-t border-slate-200 pt-4 dark:border-slate-800">
        <Field
          label="Restore from a backup file"
          hint="Replaces everything currently stored — every credential and setting — with what's in the file. Signs everyone out."
        >
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200 dark:text-slate-400 dark:file:bg-slate-800 dark:file:text-slate-300 dark:hover:file:bg-slate-700"
          />
        </Field>
        <div className="mt-3">
          <Button tone="rose" loading={busy} disabled={!file} onClick={() => setConfirming(true)}>
            Restore from backup
          </Button>
        </div>
      </div>

      {error && <ErrorNote message={error} />}
      {done && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          Restored. Reload the page — you'll need to sign in again if this backup predates your session.
        </p>
      )}

      <ConfirmDialog
        open={confirming}
        title="Restore from this backup?"
        body="This replaces every credential, instance definition and component setting currently stored with what's in the file, and will sign everyone out. This cannot be undone from here — make sure you have a current backup first if you want to keep what's there now."
        confirmLabel="Restore"
        onConfirm={restore}
        onCancel={() => setConfirming(false)}
      />
    </Section>
  );
}

function PasswordSection() {
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  return (
    <Section
      title="Change password"
      description="Changing it signs out every other session."
      footer={
        <Button
          tone="accent"
          loading={busy}
          disabled={!currentPassword || !newPassword}
          onClick={async () => {
            setBusy(true);
            setError(null);
            setDone(false);
            try {
              await api.changePassword(currentPassword, newPassword);
              setCurrent("");
              setNew("");
              setDone(true);
            } catch (err) {
              setError(err.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Change password
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Current password">
          <input
            className={FIELD}
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
        <Field label="New password" hint="At least 12 characters.">
          <input
            className={FIELD}
            type="password"
            value={newPassword}
            onChange={(e) => setNew(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
      </div>
      {error && <ErrorNote message={error} />}
      {done && <p className="text-xs text-emerald-700 dark:text-emerald-400">Password changed.</p>}
    </Section>
  );
}
