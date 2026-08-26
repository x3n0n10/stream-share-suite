import { useEffect, useState } from "react";
import Layout from "../components/Layout.jsx";
import { Button, Card, ConfirmDialog, ErrorNote, Badge } from "../components/common.jsx";
import { IconTrash, IconCheck, IconAlert } from "../components/Icons.jsx";
import { api } from "../lib/api.js";

const FIELD =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
  "placeholder:text-slate-400 focus:border-accent-500 focus:outline-none focus:ring-1 " +
  "focus:ring-accent-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white";

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

// An empty string means "leave the stored secret alone" — the server treats an
// omitted field that way, which is what lets this form exist without ever
// having been given the current value.
function secretPayload(value) {
  return value.trim() === "" ? undefined : value.trim();
}

function InstanceRow({ instance, onSaved, onDeleted }) {
  const [name, setName] = useState(instance.name);
  const [url, setUrl] = useState(instance.url);
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(instance.enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [test, setTest] = useState(null);
  const [confirming, setConfirming] = useState(false);

  const dirty =
    name !== instance.name ||
    url !== instance.url ||
    enabled !== instance.enabled ||
    apiKey.trim() !== "";

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.updateInstance(instance.id, {
        name,
        url,
        apiKey: secretPayload(apiKey),
        enabled,
      });
      setApiKey("");
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setTest({ state: "running" });
    try {
      const result = await api.testInstance({ id: instance.id, url, apiKey: secretPayload(apiKey) });
      setTest(
        result.ok
          ? { state: "ok", name: result.instance?.name || result.instance?.instance_name }
          : { state: "fail", error: result.error }
      );
    } catch (err) {
      setTest({ state: "fail", error: err.message });
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-slate-900 dark:text-white">
            {instance.name}
          </span>
          {!instance.enabled && <Badge tone="slate">Disabled</Badge>}
          {!instance.apiKeySet && <Badge tone="rose">No API key</Badge>}
        </div>
        <button
          onClick={() => setConfirming(true)}
          className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20"
          aria-label={`Remove ${instance.name}`}
        >
          <IconTrash className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="URL" hint="Reachable from the Suite, e.g. http://172.18.0.11:8080">
          <input className={FIELD} value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <Field
          label="API key"
          hint={
            instance.apiKeySet
              ? "A key is set. Leave blank to keep it, or type a new one to replace it."
              : "This instance has no key — requests to it will fail with 401."
          }
        >
          <input
            className={FIELD}
            type="password"
            value={apiKey}
            placeholder={instance.apiKeySet ? "••••••••  (unchanged)" : "INTERNAL_API_KEY"}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Enabled" hint="A disabled instance stays configured but is not polled.">
          <label className="flex items-center gap-2 py-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
            />
            Poll this instance
          </label>
        </Field>
      </div>

      {error && (
        <div className="mt-3">
          <ErrorNote message={error} />
        </div>
      )}

      {test && test.state !== "running" && (
        <div className="mt-3 flex items-start gap-2 text-xs">
          {test.state === "ok" ? (
            <>
              <IconCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              <span className="text-emerald-700 dark:text-emerald-400">
                Connected{test.name ? ` — reported itself as “${test.name}”` : ""}.
              </span>
            </>
          ) : (
            <>
              <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600" />
              <span className="text-rose-700 dark:text-rose-400">{test.error}</span>
            </>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <Button tone="accent" onClick={save} disabled={!dirty} loading={busy}>
          Save
        </Button>
        <Button tone="ghost" onClick={runTest} loading={test?.state === "running"}>
          Test connection
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        title={`Remove ${instance.name}?`}
        body="The instance itself is untouched — this only stops the Suite from polling it."
        confirmLabel="Remove"
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          setConfirming(false);
          await api.deleteInstance(instance.id);
          onDeleted();
        }}
      />
    </div>
  );
}

function AddInstance({ onAdded }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [test, setTest] = useState(null);

  function reset() {
    setName("");
    setUrl("");
    setApiKey("");
    setError(null);
    setTest(null);
    setOpen(false);
  }

  async function add(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createInstance({ name, url, apiKey });
      reset();
      onAdded();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setTest({ state: "running" });
    try {
      const result = await api.testInstance({ url, apiKey });
      setTest(result.ok ? { state: "ok" } : { state: "fail", error: result.error });
    } catch (err) {
      setTest({ state: "fail", error: err.message });
    }
  }

  if (!open) {
    return (
      <Button tone="ghost" onClick={() => setOpen(true)}>
        Add an instance
      </Button>
    );
  }

  return (
    <form
      onSubmit={add}
      className="rounded-xl border border-dashed border-slate-300 p-4 dark:border-slate-700"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" hint="How it appears throughout the UI.">
          <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </Field>
        <Field label="URL">
          <input
            className={FIELD}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://172.18.0.11:8080"
            required
          />
        </Field>
        <Field label="API key" hint="The instance's INTERNAL_API_KEY. Stored write-only.">
          <input
            className={FIELD}
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>
      </div>

      {error && (
        <div className="mt-3">
          <ErrorNote message={error} />
        </div>
      )}
      {test && test.state === "ok" && (
        <p className="mt-3 text-xs text-emerald-700 dark:text-emerald-400">Connected.</p>
      )}
      {test && test.state === "fail" && (
        <p className="mt-3 text-xs text-rose-700 dark:text-rose-400">{test.error}</p>
      )}

      <div className="mt-4 flex items-center gap-2">
        <Button type="submit" tone="accent" loading={busy}>
          Add instance
        </Button>
        <Button tone="ghost" onClick={runTest} loading={test?.state === "running"}>
          Test connection
        </Button>
        <Button tone="ghost" onClick={reset}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function Settings({ onConfigChanged }) {
  const [instances, setInstances] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);

  async function reload() {
    try {
      const [list, current] = await Promise.all([api.listInstances(), api.settings()]);
      setInstances(list.instances);
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
        <Section
          title="Instances"
          description="One StreamShare instance per IPTV provider. Adding one here takes effect on the next poll — no restart, no compose edit."
        >
          {instances === null ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : instances.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No instances yet. Add the first one below.
            </p>
          ) : (
            instances.map((instance) => (
              <InstanceRow
                key={instance.id}
                instance={instance}
                onSaved={reload}
                onDeleted={reload}
              />
            ))
          )}
          <AddInstance onAdded={reload} />
        </Section>

        {settings && <GluetunSection settings={settings} onSave={saveSettings} />}
        {settings && <GeneralSection settings={settings} onSave={saveSettings} />}
        <PasswordSection />
      </div>
    </Layout>
  );
}

function GluetunSection({ settings, onSave }) {
  const [url, setUrl] = useState(settings.gluetun.url);
  const [user, setUser] = useState(settings.gluetun.user);
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Section
      title="VPN control"
      description="Point this at gluetun's control server to get the VPN page. Leave the URL blank to hide it entirely."
      footer={
        <Button
          tone="accent"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await onSave(
              {
                gluetun: {
                  url,
                  user,
                  password: secretPayload(password),
                  apiKey: secretPayload(apiKey),
                },
              },
              "VPN settings"
            );
            setPassword("");
            setApiKey("");
            setBusy(false);
          }}
        >
          Save
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Control server URL" hint="e.g. http://172.18.0.11:8000">
          <input className={FIELD} value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <Field label="Username" hint="For gluetun's basic auth role. Leave blank to use an API key.">
          <input className={FIELD} value={user} onChange={(e) => setUser(e.target.value)} />
        </Field>
        <Field
          label="Password"
          hint={settings.gluetun.passwordSet ? "Set. Leave blank to keep it." : "Not set."}
        >
          <input
            className={FIELD}
            type="password"
            value={password}
            placeholder={settings.gluetun.passwordSet ? "••••••••  (unchanged)" : ""}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Field
          label="API key"
          hint={
            settings.gluetun.apiKeySet
              ? "Set. Basic auth wins when both are configured."
              : "Alternative to basic auth."
          }
        >
          <input
            className={FIELD}
            type="password"
            value={apiKey}
            placeholder={settings.gluetun.apiKeySet ? "••••••••  (unchanged)" : ""}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
      </div>
    </Section>
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
