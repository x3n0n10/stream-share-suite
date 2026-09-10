import { useState } from "react";
import { ConfirmDialog } from "./common.jsx";
import { api } from "../lib/api.js";

// Sits inside SchemaForm's authMode button-row (via its extraOptions prop) as
// a third pill alongside "Username & password" / "LDAP" — visually one more
// sign-in option, even though picking it fires an action instead of setting
// a draft value.
export default function UseProviderCredentialsButton({ instanceKey, onDone }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      const { fields } = await api.useProviderCredentials(instanceKey);
      onDone(fields);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={busy}
        className="rounded-lg border border-dashed border-accent-400 px-3 py-1.5 text-xs font-medium text-accent-600 hover:bg-accent-50 disabled:opacity-50 dark:border-accent-700 dark:text-accent-400 dark:hover:bg-accent-900/20"
      >
        Use provider credentials
      </button>
      <ConfirmDialog
        open={confirming}
        title="Use provider credentials?"
        body="Sets this instance's sign-in to the same username and password as its Xtream provider account. Any custom username/password stops working."
        confirmLabel="Use provider credentials"
        tone="accent"
        onConfirm={confirm}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
