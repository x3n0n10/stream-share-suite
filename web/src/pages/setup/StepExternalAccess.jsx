import { useEffect, useState } from "react";
import { Card, Button, ErrorNote, FIELD } from "../../components/common.jsx";
import SchemaForm from "../../components/SchemaForm.jsx";
import { api } from "../../lib/api.js";
import { describeFailures } from "../../lib/applyToAll.js";

export default function StepExternalAccess({ instances, onNext, onBack }) {
  const [byKey, setByKey] = useState(null); // null until seeded
  const [savingPartA, setSavingPartA] = useState(false);
  const [errorA, setErrorA] = useState(null);

  const [caddyEnabled, setCaddyEnabled] = useState(null); // null until seeded
  const [caddyFields, setCaddyFields] = useState(null);
  const [savingCaddy, setSavingCaddy] = useState(false);
  const [errorB, setErrorB] = useState(null);

  useEffect(() => {
    Promise.all(instances.map((i) => api.componentFields("instance", i.key))).then((results) => {
      const seeded = {};
      results.forEach((res, idx) => {
        const byFieldKey = Object.fromEntries(res.fields.map((f) => [f.key, f]));
        seeded[instances[idx].key] = {
          publicBaseUrl: byFieldKey.publicBaseUrl?.value || "",
          discordEnabled: !!byFieldKey.discordEnabled?.value,
          discordBotToken: "",
          discordBotTokenSet: !!byFieldKey.discordBotToken?.valueSet,
          discordAdminRoleId: byFieldKey.discordAdminRoleId?.value || "",
        };
      });
      setByKey(seeded);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.stackSettings().then((s) => setCaddyEnabled(s.caddyEnabled));
  }, []);

  useEffect(() => {
    if (caddyEnabled && !caddyFields) api.componentFields("caddy").then((r) => setCaddyFields(r.fields));
  }, [caddyEnabled, caddyFields]);

  function patch(key, fields) {
    setByKey((prev) => ({ ...prev, [key]: { ...prev[key], ...fields } }));
  }

  async function saveAccessAndContinue() {
    setSavingPartA(true);
    setErrorA(null);
    try {
      const results = await Promise.allSettled(
        instances.map((i) => {
          const values = byKey[i.key];
          const p = { publicBaseUrl: values.publicBaseUrl, discordEnabled: values.discordEnabled };
          if (values.discordEnabled) {
            // Blank means "leave the stored token alone" — same write-only
            // convention every secret field in this app already follows.
            if (values.discordBotToken.trim()) p.discordBotToken = values.discordBotToken;
            if (values.discordAdminRoleId) p.discordAdminRoleId = values.discordAdminRoleId;
          }
          return api.updateStackInstance(i.key, p);
        })
      );
      const failureMessage = describeFailures(
        instances.map((i) => ({ name: i.displayName })),
        results
      );
      if (failureMessage) {
        setErrorA(failureMessage);
        return;
      }
      onNext("vpn");
    } finally {
      setSavingPartA(false);
    }
  }

  async function toggleCaddy(enabled) {
    setErrorB(null);
    try {
      await api.saveStackSettings({ caddyEnabled: enabled });
      setCaddyEnabled(enabled);
    } catch (err) {
      setErrorB(err.message);
    }
  }

  async function saveCaddy(caddyPatch) {
    setSavingCaddy(true);
    setErrorB(null);
    try {
      await api.saveComponent("caddy", caddyPatch);
    } catch (err) {
      setErrorB(err.body?.errors?.map((e) => e.message).join(" ") || err.message);
    } finally {
      setSavingCaddy(false);
    }
  }

  if (byKey === null || caddyEnabled === null) {
    return (
      <Card className="p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">External access</h2>
        <p className="mt-5 text-sm text-slate-400">Loading…</p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">External access</h2>
      <p className="mt-1.5 max-w-prose text-sm text-slate-500 dark:text-slate-400">
        Optional, per instance. You're responsible for the DNS/routing that actually gets traffic
        to this host — this just tells each instance what its own externally-reachable address is.
      </p>

      <div className="mt-5 flex flex-col gap-6">
        {instances.map((instance) => {
          const values = byKey[instance.key];
          return (
            <div
              key={instance.key}
              className="border-t border-slate-200 pt-4 first:border-t-0 first:pt-0 dark:border-slate-800"
            >
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{instance.displayName}</h3>
              <label className="mt-3 flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Public base URL</span>
                <input
                  className={FIELD}
                  value={values.publicBaseUrl}
                  onChange={(e) => {
                    const publicBaseUrl = e.target.value;
                    patch(
                      instance.key,
                      publicBaseUrl.trim()
                        ? { publicBaseUrl }
                        : { publicBaseUrl, discordEnabled: false, discordBotToken: "", discordAdminRoleId: "" }
                    );
                  }}
                  placeholder="https://tv.example.com/provider-1"
                />
              </label>

              <label className="mt-3 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={values.discordEnabled}
                  disabled={!values.publicBaseUrl.trim()}
                  onChange={(e) => patch(instance.key, { discordEnabled: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500 disabled:opacity-50"
                />
                Enable Discord bot
                {!values.publicBaseUrl.trim() && (
                  <span className="text-xs text-slate-400">(needs a public base URL first)</span>
                )}
              </label>

              {values.discordEnabled && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Bot token</span>
                    <input
                      className={FIELD}
                      type="password"
                      value={values.discordBotToken}
                      placeholder={values.discordBotTokenSet ? "••••••••  (unchanged)" : ""}
                      onChange={(e) => patch(instance.key, { discordBotToken: e.target.value })}
                    />
                    <span className="text-[11px] text-slate-400 dark:text-slate-500">
                      {values.discordBotTokenSet
                        ? "A token is set. Leave blank to keep it, or type a new one to replace it."
                        : "Required to enable Discord."}
                    </span>
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                      Admin role ID (optional)
                    </span>
                    <input
                      className={FIELD}
                      value={values.discordAdminRoleId}
                      onChange={(e) => patch(instance.key, { discordAdminRoleId: e.target.value })}
                    />
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {errorA && (
        <div className="mt-4">
          <ErrorNote message={errorA} />
        </div>
      )}

      <div className="mt-6 border-t border-slate-200 pt-5 dark:border-slate-800">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          Also reach it from your local network?
        </h3>
        <p className="mt-1 max-w-prose text-xs text-slate-500 dark:text-slate-400">
          This is what Caddy is for, and only for this — it's independent of Discord and of whether
          you set a public URL above. You're still responsible for pointing that URL's DNS at this
          host; Caddy then routes it to the right instance and port once it arrives here.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={caddyEnabled}
            onChange={(e) => toggleCaddy(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
          />
          Publish instances through Caddy
        </label>

        {caddyEnabled && (
          <div className="mt-3">
            {caddyFields === null ? (
              <p className="text-sm text-slate-400">Loading…</p>
            ) : (
              <SchemaForm
                fields={caddyFields.filter((f) => f.group === "HTTPS")}
                onSave={saveCaddy}
                saving={savingCaddy}
                error={errorB}
                submitLabel="Save"
              />
            )}
          </div>
        )}
        {errorB && !caddyEnabled && (
          <div className="mt-3">
            <ErrorNote message={errorB} />
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center gap-2">
        {onBack && (
          <Button tone="ghost" onClick={onBack}>
            Back
          </Button>
        )}
        <div className="ml-auto">
          <Button tone="accent" onClick={saveAccessAndContinue} loading={savingPartA} disabled={savingPartA}>
            Continue
          </Button>
        </div>
      </div>
    </Card>
  );
}
