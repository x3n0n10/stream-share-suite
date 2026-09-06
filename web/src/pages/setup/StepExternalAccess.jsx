import { useEffect, useState } from "react";
import { Card, Button, ErrorNote } from "../../components/common.jsx";
import SchemaForm from "../../components/SchemaForm.jsx";
import { api } from "../../lib/api.js";
import { describeFailures } from "../../lib/applyToAll.js";

const FIELD =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
  "placeholder:text-slate-400 focus:border-accent-500 focus:outline-none focus:ring-1 " +
  "focus:ring-accent-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white";

function blankAccess() {
  return { publicBaseUrl: "", discordEnabled: false, discordBotToken: "", discordAdminRoleId: "" };
}

export default function StepExternalAccess({ instances, onNext }) {
  const [byKey, setByKey] = useState(() => Object.fromEntries(instances.map((i) => [i.key, blankAccess()])));
  const [savingPartA, setSavingPartA] = useState(false);
  const [errorA, setErrorA] = useState(null);

  const [wantsCaddy, setWantsCaddy] = useState(null); // null: not yet asked
  const [caddyFields, setCaddyFields] = useState(null);
  const [savingCaddy, setSavingCaddy] = useState(false);
  const [errorB, setErrorB] = useState(null);

  useEffect(() => {
    if (wantsCaddy && !caddyFields) api.componentFields("caddy").then((r) => setCaddyFields(r.fields));
  }, [wantsCaddy, caddyFields]);

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
          const p = { publicBaseUrl: values.publicBaseUrl };
          if (values.discordEnabled) {
            p.discordEnabled = true;
            p.discordBotToken = values.discordBotToken;
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
      setWantsCaddy(false); // move to Part B's question, default "no" until chosen
    } finally {
      setSavingPartA(false);
    }
  }

  async function chooseCaddy(enabled) {
    setErrorB(null);
    if (!enabled) {
      setWantsCaddy(false);
      onNext("vpn");
      return;
    }
    try {
      await api.saveStackSettings({ caddyEnabled: true });
      setWantsCaddy(true);
    } catch (err) {
      setErrorB(err.message);
    }
  }

  async function saveCaddyAndContinue(caddyPatch) {
    setSavingCaddy(true);
    setErrorB(null);
    try {
      await api.saveComponent("caddy", caddyPatch);
      onNext("vpn");
    } catch (err) {
      setErrorB(err.body?.errors?.map((e) => e.message).join(" ") || err.message);
    } finally {
      setSavingCaddy(false);
    }
  }

  // Part A: per-instance public URL + Discord, always shown first.
  if (wantsCaddy === null) {
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
              <div key={instance.key} className="border-t border-slate-200 pt-4 first:border-t-0 first:pt-0 dark:border-slate-800">
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
                        onChange={(e) => patch(instance.key, { discordBotToken: e.target.value })}
                      />
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

        <div className="mt-5">
          <Button tone="accent" onClick={saveAccessAndContinue} loading={savingPartA} disabled={savingPartA}>
            Continue
          </Button>
        </div>
      </Card>
    );
  }

  // Part B: the Caddy question, once, after Part A is saved.
  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">
        Also reach it from your local network?
      </h2>
      <p className="mt-1.5 max-w-prose text-sm text-slate-500 dark:text-slate-400">
        This is what Caddy is for, and only for this — it's independent of Discord and of whether
        you set a public URL above. You're still responsible for pointing that URL's DNS at this
        host; Caddy then routes it to the right instance and port once it arrives here.
      </p>

      {!wantsCaddy ? (
        <div className="mt-5 flex gap-2">
          <Button tone="accent" onClick={() => chooseCaddy(true)}>
            Yes, set up Caddy
          </Button>
          <Button tone="ghost" onClick={() => chooseCaddy(false)}>
            No, skip it
          </Button>
        </div>
      ) : caddyFields === null ? (
        <p className="mt-5 text-sm text-slate-400">Loading…</p>
      ) : (
        <div className="mt-5">
          <SchemaForm
            fields={caddyFields.filter((f) => f.group === "HTTPS")}
            onSave={saveCaddyAndContinue}
            saving={savingCaddy}
            error={errorB}
            submitLabel="Save and continue"
          />
        </div>
      )}

      {errorB && !caddyFields && (
        <div className="mt-4">
          <ErrorNote message={errorB} />
        </div>
      )}
    </Card>
  );
}
