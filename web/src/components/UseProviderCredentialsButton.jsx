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
