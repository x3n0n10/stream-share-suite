import { useState } from "react";
import { Card, Button, ErrorNote, FIELD } from "../../components/common.jsx";
import { api } from "../../lib/api.js";

const ACCESS_MODES = [
  { value: "provider", label: "Use my provider credentials" },
  { value: "custom", label: "Set custom credentials" },
  { value: "ldap", label: "Use LDAP" },
];

function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-slate-400 dark:text-slate-500">{hint}</span>}
    </label>
  );
}

function blankDraft() {
  return {
    displayName: "",
    xtreamBaseUrl: "",
    xtreamUser: "",
    xtreamPassword: "",
    accessMode: "provider",
    authUser: "",
    authPassword: "",
    ldapServer: "",
    ldapBaseDn: "",
    ldapBindDn: "",
    ldapBindPassword: "",
  };
}

// The 3-way choice ("use my provider creds" / custom / LDAP) isn't a real
// authMode value — only "basic" and "ldap" are. Picking "provider" here just
// means: submit authMode "basic" with the same username/password already
// typed into the Provider fields above, instead of asking for them again.
function toPatch(draft) {
  const base = {
    displayName: draft.displayName,
    xtreamBaseUrl: draft.xtreamBaseUrl,
    xtreamUser: draft.xtreamUser,
    xtreamPassword: draft.xtreamPassword,
  };

  if (draft.accessMode === "ldap") {
    return {
      ...base,
      authMode: "ldap",
      ldapServer: draft.ldapServer,
      ldapBaseDn: draft.ldapBaseDn,
      ldapBindDn: draft.ldapBindDn,
      ldapBindPassword: draft.ldapBindPassword,
    };
  }

  if (draft.accessMode === "custom") {
    return { ...base, authMode: "basic", authUser: draft.authUser, authPassword: draft.authPassword };
  }

  // "provider"
  return { ...base, authMode: "basic", authUser: draft.xtreamUser, authPassword: draft.xtreamPassword };
}

export default function StepInstances({ instances, setInstances, onNext }) {
  const [draft, setDraft] = useState(blankDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function set(key, value) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function addInstance(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { key, port } = await api.createStackInstance(toPatch(draft));
      setInstances((prev) => [...prev, { key, port, displayName: draft.displayName }]);
      setDraft(blankDraft());
    } catch (err) {
      setError(err.body?.errors?.map((e) => e.message).join(" ") || err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">Your instances</h2>
      <p className="mt-1.5 max-w-prose text-sm text-slate-500 dark:text-slate-400">
        One StreamShare instance per IPTV provider. At least one is required — add as many as you
        need, one at a time.
      </p>

      {instances.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1.5">
          {instances.map((i) => (
            <li
              key={i.key}
              className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60"
            >
              <span className="font-medium text-slate-800 dark:text-slate-100">{i.displayName}</span>
              <span className="text-xs text-slate-400">port {i.port}</span>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={addInstance} className="mt-5 flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <input
              className={FIELD}
              value={draft.displayName}
              onChange={(e) => set("displayName", e.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label="Xtream base URL" hint="e.g. http://provider.example:8080">
            <input
              className={FIELD}
              value={draft.xtreamBaseUrl}
              onChange={(e) => set("xtreamBaseUrl", e.target.value)}
              required
            />
          </Field>
          <Field label="Xtream username">
            <input
              className={FIELD}
              value={draft.xtreamUser}
              onChange={(e) => set("xtreamUser", e.target.value)}
              required
            />
          </Field>
          <Field label="Xtream password">
            <input
              className={FIELD}
              type="password"
              value={draft.xtreamPassword}
              onChange={(e) => set("xtreamPassword", e.target.value)}
              required
            />
          </Field>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">How users sign in</span>
          <div className="flex flex-wrap gap-2">
            {ACCESS_MODES.map((mode) => (
              <button
                key={mode.value}
                type="button"
                onClick={() => set("accessMode", mode.value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  draft.accessMode === mode.value
                    ? "bg-accent-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>

        {draft.accessMode === "custom" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Username">
              <input
                className={FIELD}
                value={draft.authUser}
                onChange={(e) => set("authUser", e.target.value)}
                required
              />
            </Field>
            <Field label="Password">
              <input
                className={FIELD}
                type="password"
                value={draft.authPassword}
                onChange={(e) => set("authPassword", e.target.value)}
                required
              />
            </Field>
          </div>
        )}

        {draft.accessMode === "ldap" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="LDAP server" hint="e.g. ldap://ldap.example:389">
              <input
                className={FIELD}
                value={draft.ldapServer}
                onChange={(e) => set("ldapServer", e.target.value)}
                required
              />
            </Field>
            <Field label="Base DN">
              <input
                className={FIELD}
                value={draft.ldapBaseDn}
                onChange={(e) => set("ldapBaseDn", e.target.value)}
                required
              />
            </Field>
            <Field label="Bind DN">
              <input
                className={FIELD}
                value={draft.ldapBindDn}
                onChange={(e) => set("ldapBindDn", e.target.value)}
                required
              />
            </Field>
            <Field label="Bind password">
              <input
                className={FIELD}
                type="password"
                value={draft.ldapBindPassword}
                onChange={(e) => set("ldapBindPassword", e.target.value)}
                required
              />
            </Field>
          </div>
        )}

        {error && <ErrorNote message={error} />}

        <div className="flex items-center gap-2">
          <Button type="submit" tone="accent" loading={saving} disabled={saving}>
            Add instance
          </Button>
          {instances.length > 0 && (
            <Button type="button" tone="ghost" onClick={() => onNext("caching")}>
              Continue with {instances.length} instance{instances.length === 1 ? "" : "s"}
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}
