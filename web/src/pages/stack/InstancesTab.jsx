// web/src/pages/stack/InstancesTab.jsx
import { useEffect, useState } from "react";
import { Card, Button, FIELD } from "../../components/common.jsx";
import SchemaForm from "../../components/SchemaForm.jsx";
import { IconRefresh, IconEdit, IconTrash } from "../../components/Icons.jsx";
import { api } from "../../lib/api.js";
import { previewContainerName, previewContainerNameForKey } from "../../lib/containerName.js";
import HistoryPanel from "./HistoryPanel.jsx";

// The band an instance's port is allocated from — a fixed 20 slots starting
// here. Only worth changing if that range is already taken by something else
// on the host; an instance whose port still fits the new range keeps it, one
// that doesn't gets moved to a free port in it (server-side, on save).
function PortRangeSetting({ settings, onSave, busy }) {
  const [draft, setDraft] = useState(String(settings.instancePortStart));
  const [error, setError] = useState(null);

  useEffect(() => {
    setDraft(String(settings.instancePortStart));
  }, [settings.instancePortStart]);

  async function save() {
    setError(null);
    try {
      await onSave({ instancePortStart: Number(draft) });
    } catch (err) {
      setError(err.message);
    }
  }

  const dirty = Number(draft) !== settings.instancePortStart;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Instance port range</h2>
        <p className="mt-1 max-w-prose text-xs text-slate-500 dark:text-slate-400">
          Instances are allocated 20 ports starting here (currently {settings.instancePortStart}–
          {settings.instancePortStart + 19}). Instances already inside the range keep their port;
          any that fall outside the new range move to a free port in it.
        </p>
        {error && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <input
          type="number"
          className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button tone="ghost" onClick={save} disabled={busy || !dirty}>
          Save
        </Button>
      </div>
    </div>
  );
}

// Removing an instance asks about its database rather than deciding for you.
// The container is trivially rebuilt; the watch history is not, so keeping it
// is the default and dropping it needs the name typed back.
function RemoveInstanceDialog({ instance, dropDatabase, onToggleDrop, onConfirm, onCancel }) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!instance) setTyped("");
  }, [instance]);

  if (!instance) return null;

  const confirmed = !dropDatabase || typed === instance.displayName;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} aria-hidden="true" />
      <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          Remove {instance.displayName}?
        </h3>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          This takes it out of the stack. Its container keeps running until you apply the plan,
          which will then offer to remove it.
        </p>

        <label className="mt-4 flex items-start gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <input
            type="checkbox"
            checked={dropDatabase}
            onChange={(e) => onToggleDrop(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
          />
          <span className="text-xs text-slate-600 dark:text-slate-400">
            Also drop <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{instance.databaseName}</code> and
            its role. <strong className="text-rose-600 dark:text-rose-400">This deletes its watch
            history permanently.</strong> Leave it unticked to keep the data.
          </span>
        </label>

        {dropDatabase && (
          <label className="mt-3 flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Type <strong>{instance.displayName}</strong> to confirm
            </span>
            <input
              className={FIELD}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
            />
          </label>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button tone="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button tone="rose" onClick={onConfirm} disabled={!confirmed}>
            {dropDatabase ? "Remove and drop database" : "Remove"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ConnectInfo({ instances }) {
  return (
    <div className="rounded-xl border border-accent-200 bg-accent-50 px-4 py-3 text-xs text-accent-800 dark:border-accent-900/50 dark:bg-accent-900/20 dark:text-accent-300">
      <p className="text-sm font-medium">Connecting to your instances</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {instances.map((instance) => (
          <li key={instance.key}>
            <span className="font-medium">{instance.displayName}:</span>{" "}
            <span className="font-mono">{instance.url}</span>
            {instance.publicBaseUrl && (
              <>
                {" · "}
                <span className="font-mono">{instance.publicBaseUrl}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function InstancesTab({
  settings,
  onSaveSettings,
  instances,
  portBand,
  containerPrefix,
  busy,
  onAdd,
  onEdit,
  onConfirmRemove,
  onPull,
  onRestored,
}) {
  const [adding, setAdding] = useState(false);
  const [addFields, setAddFields] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const [editingKey, setEditingKey] = useState(null);
  const [editFields, setEditFields] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState(null);

  const [instanceToRemove, setInstanceToRemove] = useState(null);
  const [dropDatabase, setDropDatabase] = useState(false);

  useEffect(() => {
    if (!adding || addFields) return;
    api.componentFields("instance").then((res) => setAddFields(res.fields));
  }, [adding, addFields]);

  useEffect(() => {
    if (!editingKey || editFields) return;
    api.componentFields("instance", editingKey).then((res) => setEditFields(res.fields));
  }, [editingKey, editFields]);

  function toggleAdding() {
    setEditingKey(null);
    setEditFields(null);
    setAdding((v) => !v);
    setAddFields(null);
    setError(null);
  }

  function toggleEditing(key) {
    setAdding(false);
    setAddFields(null);
    setError(null);
    setEditingKey((current) => (current === key ? null : key));
    setEditFields(null);
    setEditError(null);
  }

  async function create(patch) {
    setSaving(true);
    setError(null);
    try {
      await onAdd(patch);
      setAdding(false);
      setAddFields(null);
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
      await onEdit(editingKey, patch);
      setEditingKey(null);
      setEditFields(null);
    } catch (err) {
      setEditError(err.body?.errors?.map((e) => e.message).join(" ") || err.message);
    } finally {
      setEditSaving(false);
    }
  }

  async function confirmRemove() {
    const target = instanceToRemove;
    const drop = dropDatabase;
    setInstanceToRemove(null);
    setDropDatabase(false);
    await onConfirmRemove(target.key, { dropDatabase: drop });
  }

  return (
    <div className="flex flex-col gap-4">
      {settings && (
        <Card className="p-5">
          <PortRangeSetting settings={settings} onSave={onSaveSettings} busy={busy} />
        </Card>
      )}

      {instances.length > 0 && <ConnectInfo instances={instances} />}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Instances</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              One per IPTV provider. Ports are allocated from {portBand?.first}–{portBand?.last}; the
              address and API key are worked out for you.
            </p>
          </div>
          <Button tone="accent" onClick={toggleAdding} disabled={busy}>
            {adding ? "Cancel" : "Add instance"}
          </Button>
        </div>

        {instances.length === 0 && !adding && (
          <p className="px-5 py-6 text-sm text-slate-500 dark:text-slate-400">
            No instances yet. Adding one creates its container, its database and its API key.
          </p>
        )}

        {instances.length > 0 && (
          <ul>
            {instances.map((instance) => (
              <li key={instance.key} className="border-b border-slate-200 last:border-b-0 dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                      {instance.displayName}
                    </p>
                    {(instance.containerName || instance.port) && (
                      <p className="mt-0.5 truncate text-xs text-slate-400">
                        {[
                          instance.containerName && `Container name: ${instance.containerName}`,
                          instance.port && `Port: ${instance.port}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      onClick={() => onPull(instance.key)}
                      disabled={busy}
                      aria-label="Check for updates"
                      title="Pull this instance's own configured image tag and recreate only if it actually changed"
                      className="rounded-lg p-1.5 text-accent-600 hover:bg-accent-50 disabled:opacity-50 dark:text-accent-400 dark:hover:bg-accent-900/30"
                    >
                      <IconRefresh className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => toggleEditing(instance.key)}
                      disabled={busy}
                      aria-label={editingKey === instance.key ? "Close" : "Edit"}
                      title={editingKey === instance.key ? "Close" : "Edit"}
                      className="rounded-lg p-1.5 text-accent-600 hover:bg-accent-50 disabled:opacity-50 dark:text-accent-400 dark:hover:bg-accent-900/30"
                    >
                      {editingKey === instance.key ? (
                        <span className="text-xs font-medium">Close</span>
                      ) : (
                        <IconEdit className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      onClick={() => setInstanceToRemove(instance)}
                      disabled={busy}
                      aria-label="Remove"
                      title="Remove"
                      className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-900/30"
                    >
                      <IconTrash className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {editingKey === instance.key && (
                  <div className="border-t border-slate-200 px-5 py-5 dark:border-slate-800">
                    {editFields === null ? (
                      <p className="text-sm text-slate-400">Loading…</p>
                    ) : (
                      <SchemaForm
                        fields={editFields}
                        onSave={saveEdit}
                        saving={editSaving}
                        error={editError}
                        submitLabel="Save changes"
                        preview={(draft) => (
                          <p className="-mt-2 font-mono text-xs text-slate-500 dark:text-slate-400">
                            Container name:{" "}
                            {previewContainerNameForKey(draft, { prefix: containerPrefix, key: instance.key })}
                          </p>
                        )}
                      />
                    )}

                    <HistoryPanel
                      kind="instance"
                      componentKey={instance.key}
                      busy={busy}
                      onRestored={async () => {
                        setEditFields(null);
                        await onRestored();
                      }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {adding && (
          <div className="border-t border-slate-200 px-5 py-5 dark:border-slate-800">
            {addFields === null ? (
              <p className="text-sm text-slate-400">Loading…</p>
            ) : (
              <SchemaForm
                fields={addFields}
                onSave={create}
                saving={saving}
                error={error}
                submitLabel="Create instance"
                preview={(draft) => (
                  <p className="-mt-2 font-mono text-xs text-slate-500 dark:text-slate-400">
                    Container name:{" "}
                    {previewContainerName(draft, { prefix: containerPrefix, existingKeys: instances.map((i) => i.key) })}
                  </p>
                )}
              />
            )}
          </div>
        )}
      </Card>

      <RemoveInstanceDialog
        instance={instanceToRemove}
        dropDatabase={dropDatabase}
        onToggleDrop={setDropDatabase}
        onConfirm={confirmRemove}
        onCancel={() => {
          setInstanceToRemove(null);
          setDropDatabase(false);
        }}
      />
    </div>
  );
}
