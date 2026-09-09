# Restore an instance's "use provider credentials" sign-in after setup

## Context

An instance's sign-in ("How users sign in", `authMode`) is a real 2-value
enum server-side — `basic` or `ldap` (`server/src/schema/instance.js`). "Use
my provider credentials" is a third option shown only in the add-instance
form (`web/src/pages/setup/StepInstances.jsx`'s `ACCESS_MODES`), and it isn't
a real `authMode` value at all: picking it just submits `authMode: "basic"`
with `authUser`/`authPassword` copied from whatever Xtream username/password
were typed into the Provider fields above, at that one moment
(`StepInstances.jsx`'s `toPatch`).

Once an instance exists, every edit surface — the wizard's own per-instance
edit block and the Stack page's `InstancesTab.jsx` — renders the real schema
through the generic `SchemaForm`, whose `authMode` select only ever offers
the two real values. There is no way to tell, from that form, whether the
current `basic` credentials happen to equal the Xtream ones or were
customized, and no way to reset them back to the Xtream ones short of
retyping the Xtream password by hand — which the operator may not even have
in front of them, and which the form can't prefill anyway, since secret
fields are write-only and never echoed to the browser
(`toPublicFields` in `server/src/schema/registry.js`).

This spec adds that reset back as a repeatable action, available after
setup, in both edit surfaces.

## Scope

**In scope:**
- A new backend action that copies an instance's already-stored Xtream
  username/password into its `authUser`/`authPassword`, entirely
  server-side.
- A button that triggers it, in the wizard's instance-edit block and in the
  Stack page's `InstancesTab.jsx` instance-edit block, guarded by a
  confirmation prompt.

**Out of scope:**
- No change to `authMode`'s schema — it stays the real 2-value enum
  (`basic`/`ldap`). "Provider credentials" is not modeled as a persisted
  third state (decided during brainstorming: a one-time reset is enough;
  no live link that re-syncs automatically if the Xtream password changes
  later).
- No change to the add-instance flow (`StepInstances.jsx`'s `ACCESS_MODES`/
  `toPatch`) — it already does the equivalent copy at creation time.
- `SchemaForm` itself is not touched. It stays generic over any component's
  schema (per its own header comment); the new button is instance-specific
  logic, so it belongs in the two callers that already know they're
  rendering an instance, not inside the generic form.
- M3U instances: unaffected. The action is only offered — and only valid —
  when `providerType === "xtream"`, since M3U instances have no separate
  username/password to copy.

## What changes

**`server/src/routes/stack.js`:** a new route next to the existing
`POST /instances/:key/remove`:

```js
// Copies this instance's own Xtream username/password into its authUser/
// authPassword — the same one-time copy the add-instance wizard's "Use my
// provider credentials" option does at creation, made repeatable after the
// fact. Entirely server-side: authPassword is a secret field the browser
// never sees (see toPublicFields), so there is no other way to offer this
// once an instance already exists.
router.post("/instances/:key/use-provider-credentials", (req, res) => {
  const key = req.params.key;
  if (listComponents("instance").every((row) => row.key !== key)) {
    return res.status(404).json({ error: `Unknown instance: ${key}` });
  }

  const { schema } = getCatalogEntry("instance");
  const existing = getComponentValues("instance", key);
  if (existing.providerType !== "xtream") {
    return res.status(400).json({ error: "Only an Xtream instance has provider credentials to use." });
  }

  const next = {
    ...existing,
    authMode: "basic",
    authUser: existing.xtreamUser,
    authPassword: existing.xtreamPassword,
  };
  saveComponentValues("instance", next, key);
  res.json({ fields: toPublicFields(schema, next) });
});
```

Placed after the `PUT /instances/:key` route and before
`POST /instances/:key/remove`, matching the file's existing ordering (create,
edit, action routes).

**`web/src/lib/api.js`:** one new method next to `removeStackInstance`:

```js
useProviderCredentials: (key) => post(`/api/stack/instances/${key}/use-provider-credentials`),
```

**`web/src/pages/setup/StepInstances.jsx`:** inside the existing
`editingKey === i.key` block (currently lines 235-249), a button appears
above the `<SchemaForm>` when the loaded `editFields` show
`providerType === "xtream"`:

```jsx
{editingKey === i.key && (
  <div className="border-t border-slate-200 px-3 py-3 dark:border-slate-800">
    {editFields === null ? (
      <p className="text-sm text-slate-400">Loading…</p>
    ) : (
      <>
        {editFields.find((f) => f.key === "providerType")?.value === "xtream" && (
          <UseProviderCredentialsButton
            instanceKey={i.key}
            onDone={(fields) => setEditFields(fields)}
          />
        )}
        <SchemaForm
          fields={editFields}
          onSave={saveEdit}
          saving={editSaving}
          error={editError}
          submitLabel="Save changes"
        />
      </>
    )}
  </div>
)}
```

A small shared component (new file,
`web/src/components/UseProviderCredentialsButton.jsx`, since both
`StepInstances.jsx` and `InstancesTab.jsx` need the identical button +
confirm + call + error-display behavior):

```jsx
import { useState } from "react";
import { Button, ErrorNote } from "./common.jsx";
import { api } from "../lib/api.js";

export default function UseProviderCredentialsButton({ instanceKey, onDone }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const { fields } = await api.useProviderCredentials(instanceKey);
      onDone(fields);
      setConfirming(false);
    } catch (err) {
      setError(err.body?.error || err.message);
    } finally {
      setBusy(false);
    }
  }

  if (confirming) {
    return (
      <div className="mb-3 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-900/20">
        <p className="text-xs text-amber-800 dark:text-amber-200">
          Reset to provider credentials? Any custom username/password for this instance will stop
          working.
        </p>
        {error && <ErrorNote message={error} />}
        <div className="flex gap-2">
          <Button type="button" tone="accent" onClick={confirm} loading={busy} disabled={busy}>
            Reset
          </Button>
          <Button type="button" tone="ghost" onClick={() => setConfirming(false)} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-3">
      <Button type="button" tone="ghost" onClick={() => setConfirming(true)}>
        Use provider credentials
      </Button>
    </div>
  );
}
```

**`web/src/pages/stack/InstancesTab.jsx`:** the same button, in the same
place relative to its own edit block's `<SchemaForm>` (around line 370),
with `onDone={(fields) => setEditFields(fields)}` — same shape, since this
file's edit state (`editFields`) mirrors the wizard's.

## Testing

`node --test` (existing backend runner; `web/` has none — matching the
convention already noted in prior specs). New cases in
`server/test/stack-routes.test.js`, alongside the existing
`POST .../remove` tests:

- Using provider credentials on an Xtream instance sets `authMode` to
  `"basic"` and `authUser`/`authPassword` to that instance's current
  `xtreamUser`/`xtreamPassword` — verified through the same
  `toPublicFields`-redacted response the route returns (`authUser`'s
  plain value, `authPassword`'s `valueSet: true`), not by reading the
  database directly.
- Using it on an M3U instance is a 400, and makes no change to that
  instance's stored values.
- Using it on an unknown instance key is a 404.

## Out of scope (deliberately)

- Any persisted "provider" `authMode` value, or automatic re-sync if the
  Xtream password changes later — explicitly ruled out during
  brainstorming in favor of a one-time, repeatable reset.
- Any change to `SchemaForm`'s generic rendering.
- Any change to the add-instance flow's own existing copy-at-creation
  behavior.
- LDAP-mode instances: the button only ever offers to reset to provider
  credentials; it does not address switching an LDAP instance to provider
  credentials any differently than a `basic`-mode one — both go through the
  same route once `providerType === "xtream"`, since neither the current
  `authMode` nor an LDAP config is read by the new route at all.
