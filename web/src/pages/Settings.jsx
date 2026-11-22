import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Layout from "../components/Layout.jsx";
import { Button, Card, ConfirmDialog, ErrorNote, FIELD, OnOffToggle } from "../components/common.jsx";
import { api } from "../lib/api.js";
import { useFormat } from "../lib/useFormat.js";
import { errorText } from "../lib/serverText.js";

// A label forwards clicks on its text to its first button, so a field that holds
// buttons (an on/off toggle) must not be one: pass as="div".
function Field({ label, hint, children, as: Tag = "label" }) {
  return (
    <Tag className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-slate-400 dark:text-slate-500">{hint}</span>}
    </Tag>
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
  const { t } = useTranslation();
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);

  async function reload() {
    try {
      const current = await api.settings();
      setSettings(current);
      onConfigChanged?.();
    } catch (err) {
      setError(err);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveSettings(payload) {
    setError(null);
    try {
      await api.saveSettings(payload);
      setSaved(true);
      setTimeout(() => setSaved(null), 2500);
      reload();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Layout title={t("nav.settings")}>
      {error && (
        <div className="mb-4">
          <ErrorNote message={errorText(error, t)} />
        </div>
      )}
      {saved && (
        <p className="mb-4 text-xs text-emerald-700 dark:text-emerald-400">{t("settings.generalSaved")}</p>
      )}

      <div className="flex flex-col gap-4">
        {settings && <GeneralSection settings={settings} onSave={saveSettings} onReload={reload} />}
        <PasswordSection />
        <ApiAccessSection />
        <BackupSection />
      </div>
    </Layout>
  );
}

function GeneralSection({ settings, onSave, onReload }) {
  const { t } = useTranslation();
  const { formatDateTime } = useFormat();
  const [title, setTitle] = useState(settings.general.title);
  const [pollIntervalMs, setPoll] = useState(settings.general.pollIntervalMs);
  const [instanceTimeoutMs, setTimeout_] = useState(settings.general.instanceTimeoutMs);
  const [autoUpdateCheck, setAutoUpdateCheck] = useState(settings.general.autoUpdateCheck !== false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkNote, setCheckNote] = useState(null); // { partial: true } or { error }

  async function checkNow() {
    setChecking(true);
    setCheckNote(null);
    try {
      const result = await api.checkForUpdates();
      setCheckNote(result.complete ? null : { partial: true });
      window.dispatchEvent(new Event("versions:refresh"));
      await onReload();
    } catch (err) {
      setCheckNote({ error: err });
    }
    setChecking(false);
  }

  return (
    <Section
      title={t("settings.general.title")}
      description={t("settings.general.description")}
      footer={
        <Button
          tone="accent"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await onSave(
              { general: { title, pollIntervalMs: Number(pollIntervalMs), instanceTimeoutMs: Number(instanceTimeoutMs), autoUpdateCheck } }
            );
            setBusy(false);
          }}
        >
          {t("common.save")}
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("settings.general.siteTitle")} hint={t("settings.general.siteTitleHint")}>
          <input className={FIELD} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={t("settings.general.poll")} hint={t("settings.general.pollHint")}>
          <input
            className={FIELD}
            type="number"
            value={pollIntervalMs}
            onChange={(e) => setPoll(e.target.value)}
          />
        </Field>
        <Field label={t("settings.general.timeout")} hint={t("settings.general.timeoutHint")}>
          <input
            className={FIELD}
            type="number"
            value={instanceTimeoutMs}
            onChange={(e) => setTimeout_(e.target.value)}
          />
        </Field>
        <Field
          as="div"
          label={t("settings.general.autoCheck")}
          hint={t("settings.general.autoCheckHint")}
        >
          <OnOffToggle value={autoUpdateCheck} onChange={setAutoUpdateCheck} />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button tone="ghost" loading={checking} disabled={!autoUpdateCheck} onClick={checkNow}>
              {t("settings.general.checkNow")}
            </Button>
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              {settings.general.updateCheckedAt
                ? t("settings.general.lastChecked", { when: formatDateTime(settings.general.updateCheckedAt) })
                : t("settings.general.notChecked")}
            </span>
          </div>
          {checkNote && <span className="text-[11px] text-amber-600 dark:text-amber-400">{checkNote.partial ? t("settings.general.checksFailed") : errorText(checkNote.error, t)}</span>}
        </Field>
      </div>
    </Section>
  );
}

function BackupSection() {
  const { t } = useTranslation();
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
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title={t("settings.backup.title")}
      description={t("settings.backup.description")}
    >
      <div>
        <Button tone="default" onClick={() => window.location.assign("/api/backup")}>
          {t("settings.backup.download")}
        </Button>
      </div>

      <div className="mt-2 border-t border-slate-200 pt-4 dark:border-slate-800">
        <Field
          label={t("settings.backup.restoreLabel")}
          hint={t("settings.backup.restoreHint")}
        >
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200 dark:text-slate-400 dark:file:bg-slate-800 dark:file:text-slate-300 dark:hover:file:bg-slate-700"
          />
        </Field>
        <div className="mt-3">
          <Button tone="rose" loading={busy} disabled={!file} onClick={() => setConfirming(true)}>
            {t("settings.backup.restore")}
          </Button>
        </div>
      </div>

      {error && <ErrorNote message={errorText(error, t)} />}
      {done && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          {t("settings.backup.restored")}
        </p>
      )}

      <ConfirmDialog
        open={confirming}
        title={t("settings.backup.confirmTitle")}
        body={t("settings.backup.confirmBody")}
        confirmLabel={t("settings.backup.confirm")}
        onConfirm={restore}
        onCancel={() => setConfirming(false)}
      />
    </Section>
  );
}

function PasswordSection() {
  const { t } = useTranslation();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  return (
    <Section
      title={t("settings.password.title")}
      description={t("settings.password.description")}
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
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("settings.password.submit")}
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("settings.password.current")}>
          <input
            className={FIELD}
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
        <Field label={t("settings.password.new")} hint={t("settings.password.newHint")}>
          <input
            className={FIELD}
            type="password"
            value={newPassword}
            onChange={(e) => setNew(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
      </div>
      {error && <ErrorNote message={errorText(error, t)} />}
      {done && <p className="text-xs text-emerald-700 dark:text-emerald-400">{t("settings.password.changed")}</p>}
    </Section>
  );
}

function ApiAccessSection() {
  const { t } = useTranslation();
  const { formatDateTime } = useFormat();
  const [status, setStatus] = useState(null);
  const [token, setToken] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // "regenerate" | "revoke" | null — both break whatever uses the old token.
  const [confirming, setConfirming] = useState(null);

  useEffect(() => {
    api.apiToken().then(setStatus, setError);
  }, []);

  async function run(action) {
    setConfirming(null);
    setBusy(true);
    setError(null);
    try {
      if (action === "revoke") {
        setStatus(await api.revokeApiToken());
        setToken(null);
      } else {
        const created = await api.createApiToken();
        setToken(created.token);
        setStatus({ exists: true, createdAt: created.createdAt });
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  return (
    <Section
      title={t("settings.api.title")}
      description={t("settings.api.description")}
      footer={
        <>
          <Button
            tone="accent"
            loading={busy}
            onClick={() => (status.exists ? setConfirming("regenerate") : run("generate"))}
          >
            {status.exists ? t("settings.api.regenerate") : t("settings.api.generate")}
          </Button>
          {status.exists && (
            <Button tone="ghost" disabled={busy} onClick={() => setConfirming("revoke")}>
              {t("settings.api.revoke")}
            </Button>
          )}
        </>
      }
    >
      <p className="text-xs text-slate-600 dark:text-slate-400">
        {status.exists ? t("settings.api.exists", { when: formatDateTime(status.createdAt) }) : t("settings.api.none")}
      </p>

      {token && (
        <Field label={t("settings.api.newToken")} hint={t("settings.api.newTokenHint")}>
          <div className="flex gap-2">
            <input
              className={`${FIELD} font-mono`}
              readOnly
              value={token}
              onFocus={(e) => e.target.select()}
            />
            {navigator.clipboard && (
              <Button tone="ghost" onClick={() => navigator.clipboard.writeText(token)}>
                {t("common.copy")}
              </Button>
            )}
          </div>
        </Field>
      )}

      {error && <ErrorNote message={errorText(error, t)} />}

      <ConfirmDialog
        open={!!confirming}
        title={confirming === "revoke" ? t("settings.api.revokeTitle") : t("settings.api.replaceTitle")}
        body={t("settings.api.confirmBody")}
        confirmLabel={confirming === "revoke" ? t("settings.api.revoke") : t("settings.api.regenerate")}
        onConfirm={() => run(confirming)}
        onCancel={() => setConfirming(null)}
      />
    </Section>
  );
}
