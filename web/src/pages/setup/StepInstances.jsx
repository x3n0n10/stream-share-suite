import { useEffect, useState } from "react";
import { Card, Button, ErrorNote, FIELD } from "../../components/common.jsx";
import SchemaForm from "../../components/SchemaForm.jsx";
import { api } from "../../lib/api.js";

const ACCESS_MODES = [
  {
    value: "provider",
    label: "Use my provider credentials",
    help: "Simplest option — everyone signs in with the same Xtream username and password typed in above.",
  },
  {
    value: "custom",
    label: "Set custom credentials",
    help: "A separate username and password from your provider's, for sharing without handing out the real ones.",
  },
  {
    value: "ldap",
    label: "Use LDAP",
    help: "Sign in against an existing directory server instead — for handing out per-user access.",
  },
];

const PROVIDER_TYPES = [
  {
    value: "xtream",
    label: "Xtream API (recommended)",
    help: "Unlocks VOD, series, EPG and subscription status. Use this if your provider offers an Xtream API — most do.",
  },
  {
    value: "m3u",
    label: "M3U playlist",
    help: "Just a playlist link, no Xtream API. Live channels work; no VOD/series/EPG or subscription status.",
  },
];

// Groups editable here — Addressing/Discord/Caching/Health check/Container
// each have their own dedicated later step, so an existing instance's edit
// form shouldn't duplicate them. displayName is its own "Instance" group,
// separate from "Provider" — both need including for this to show the same
// fields the add-flow above collects.
const EDIT_GROUPS = ["Instance", "Provider", "Access"];

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
    providerType: "xtream",
    xtreamBaseUrl: "",
    xtreamUser: "",
    xtreamPassword: "",
    m3uUrl: "",
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
    providerType: draft.providerType,
    ...(draft.providerType === "m3u"
      ? { m3uUrl: draft.m3uUrl }
      : {
          xtreamBaseUrl: draft.xtreamBaseUrl,
          xtreamUser: draft.xtreamUser,
          xtreamPassword: draft.xtreamPassword,
        }),
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

export default function StepInstances({ instances, setInstances, onNext, onBack }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(blankDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Only one of "adding" / "editing an existing one" open at a time — same
  // convention Stack's own instance list already uses.
  const [editingKey, setEditingKey] = useState(null);
  const [editFields, setEditFields] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState(null);

  useEffect(() => {
    if (!editingKey || editFields) return;
    api.componentFields("instance", editingKey).then((res) => {
      setEditFields(res.fields.filter((f) => EDIT_GROUPS.includes(f.group)));
    });
  }, [editingKey, editFields]);

  function set(key, value) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  // Leaving Xtream mode with "provider" sign-in selected would submit a
  // patch that references xtreamUser/xtreamPassword — fields that no longer
  // exist in the draft once M3U is picked. Reset to "custom" instead of
  // letting that combination happen.
  function setProviderType(value) {
    setDraft((prev) => ({
      ...prev,
      providerType: value,
      accessMode: value === "m3u" && prev.accessMode === "provider" ? "custom" : prev.accessMode,
    }));
  }

  function toggleAdding() {
    setEditingKey(null);
    setEditFields(null);
    setAdding((v) => !v);
    setError(null);
  }

  function toggleEditing(key) {
    setAdding(false);
    setError(null);
    setEditingKey((current) => (current === key ? null : key));
    setEditFields(null);
    setEditError(null);
  }

  async function addInstance(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { key, port } = await api.createStackInstance(toPatch(draft));
      setInstances((prev) => [...prev, { key, port, displayName: draft.displayName }]);
      setDraft(blankDraft());
      setAdding(false);
    } catch (err) {
      setError(err.body?.errors?.map((e) => e.message).join(" ") || err.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(patch) {
    setEditSaving(true);
    setEditError(null);
    try {
      await api.updateStackInstance(editingKey, patch);
      setInstances((prev) =>
        prev.map((i) => (i.key === editingKey ? { ...i, displayName: patch.displayName } : i))
      );
      setEditingKey(null);
      setEditFields(null);
    } catch (err) {
      setEditError(err.body?.errors?.map((e) => e.message).join(" ") || err.message);
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">Your instances</h2>
      <p className="mt-1.5 max-w-prose text-sm text-slate-500 dark:text-slate-400">
        One StreamShare instance per IPTV provider. At least one is required. To remove an
        instance, use the Stack page instead — it's not available here.
      </p>

      {instances.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {instances.map((i) => (
            <li key={i.key} className="rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                    {i.displayName}
                  </p>
                  {(i.containerName || i.port) && (
                    <p className="truncate text-xs text-slate-400">
                      {[
                        i.containerName && `Container name: ${i.containerName}`,
                        i.port && `Port: ${i.port}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => toggleEditing(i.key)}
                  className="shrink-0 text-xs font-medium text-accent-600 hover:underline dark:text-accent-400"
                >
                  {editingKey === i.key ? "Hide" : "Edit"}
                </button>
              </div>

              {editingKey === i.key && (
                <div className="border-t border-slate-200 px-3 py-3 dark:border-slate-800">
                  {editFields === null ? (
                    <p className="text-sm text-slate-400">Loading…</p>
                  ) : (
                    <SchemaForm
                      fields={editFields}
                      onSave={saveEdit}
                      saving={editSaving}
                      error={editError}
                      submitLabel="Save changes"
                    />
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4">
        <Button type="button" tone="ghost" onClick={toggleAdding}>
          {adding ? "Cancel" : "+ Add another instance"}
        </Button>
      </div>

      {adding && (
        <form
          onSubmit={addInstance}
          className="mt-4 flex flex-col gap-5 border-t border-slate-200 pt-4 dark:border-slate-800"
        >
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
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Playlist source</span>
            <div className="flex flex-wrap gap-2">
              {PROVIDER_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setProviderType(type.value)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                    draft.providerType === type.value
                      ? "bg-accent-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                  }`}
                >
                  {type.label}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              {PROVIDER_TYPES.find((t) => t.value === draft.providerType)?.help}
            </span>
          </div>

          {draft.providerType === "xtream" ? (
            <div className="grid gap-3 sm:grid-cols-2">
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
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="M3U playlist URL"
                hint="e.g. http://provider.example/get.php?username=u&password=p&type=m3u_plus&output=m3u8"
              >
                <input
                  className={FIELD}
                  value={draft.m3uUrl}
                  onChange={(e) => set("m3uUrl", e.target.value)}
                  required
                />
              </Field>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">How users sign in</span>
            <div className="flex flex-wrap gap-2">
              {ACCESS_MODES.filter((mode) => mode.value !== "provider" || draft.providerType === "xtream").map(
                (mode) => (
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
                )
              )}
            </div>
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              {ACCESS_MODES.find((m) => m.value === draft.accessMode)?.help}
            </span>
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

          <div>
            <Button type="submit" tone="accent" loading={saving} disabled={saving}>
              Add instance
            </Button>
          </div>
        </form>
      )}

      <div className="mt-5 flex items-center gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
        {onBack && (
          <Button type="button" tone="ghost" onClick={onBack}>
            Back
          </Button>
        )}
        <div className="ml-auto">
          <Button type="button" tone="accent" onClick={() => onNext("features")} disabled={instances.length === 0}>
            {instances.length === 0
              ? "Add at least one instance to continue"
              : `Continue with ${instances.length} instance${instances.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </Card>
  );
}
