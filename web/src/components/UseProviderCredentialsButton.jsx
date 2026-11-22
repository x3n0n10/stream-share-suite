import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "./common.jsx";
import { api } from "../lib/api.js";

const PILL =
  "rounded-lg border border-dashed border-accent-400 px-3 py-1.5 text-xs font-medium text-accent-600 hover:bg-accent-50 disabled:opacity-50 dark:border-accent-700 dark:text-accent-400 dark:hover:bg-accent-900/20";

// The add-form counterpart: no instance exists yet, so there is nothing
// server-side to copy from — the Xtream login is still sitting in the form's
// own draft, and this just copies it into the sign-in fields. One-time, like
// the wizard's version; editing the Xtream password afterwards doesn't
// follow through.
export function CopyProviderCredentialsButton({ draft, set }) {
  const { t } = useTranslation();
  if (draft.providerType !== "xtream") return null;
  const ready = Boolean(draft.xtreamUser && draft.xtreamPassword);

  return (
    <button
      type="button"
      disabled={!ready}
      title={ready ? undefined : t("providerCredentials.needXtream")}
      onClick={() => {
        set("authMode", "basic");
        set("authUser", draft.xtreamUser);
        set("authPassword", draft.xtreamPassword);
      }}
      className={PILL}
    >
      {t("providerCredentials.button")}
    </button>
  );
}

// Sits inside SchemaForm's authMode button-row (via its extraOptions prop) as
// a third pill alongside "Username & password" / "LDAP" — visually one more
// sign-in option, even though picking it fires an action instead of setting
// a draft value.
export default function UseProviderCredentialsButton({ instanceKey, onDone }) {
  const { t } = useTranslation();
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
        className={PILL}
      >
        {t("providerCredentials.button")}
      </button>
      <ConfirmDialog
        open={confirming}
        title={t("providerCredentials.confirmTitle")}
        body={t("providerCredentials.confirmBody")}
        confirmLabel={t("providerCredentials.button")}
        tone="accent"
        onConfirm={confirm}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
