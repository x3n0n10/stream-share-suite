import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import { Card, Button, ErrorNote } from "../components/common.jsx";
import SchemaForm from "../components/SchemaForm.jsx";
import { api } from "../lib/api.js";

// A guided path through the same three forms Stack already offers on its
// own — gluetun, PostgreSQL, one instance — for the one moment that order
// actually matters: a fresh install, where nothing exists yet and it isn't
// obvious which card to open first. Nothing here does anything a component's
// own card on Stack couldn't already do; this only sequences it and explains
// each step as it comes, then hands off to Stack's plan to actually apply it.
//
// Steps, by index: 0 welcome/VPN choice, 1 gluetun (skipped if VPN is off),
// 2 PostgreSQL, 3 first instance (skippable), 4 done. Nothing here is
// destructive or one-way — every step just saves through the same API the
// Stack page uses, so leaving mid-wizard and finishing configuration there
// instead works exactly the same as finishing it here.
const STEP_LABELS = ["Welcome", "VPN", "Database", "Instance", "Done"];

function Loading() {
  return <p className="text-sm text-slate-400">Loading…</p>;
}

function StepCard({ title, description, children }) {
  return (
    <Card className="p-6">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>
      {description && (
        <p className="mt-1.5 max-w-prose text-sm text-slate-500 dark:text-slate-400">{description}</p>
      )}
      <div className="mt-5">{children}</div>
    </Card>
  );
}

function Progress({ step, vpnEnabled }) {
  const labels = vpnEnabled ? STEP_LABELS : STEP_LABELS.filter((l) => l !== "VPN");
  const current = vpnEnabled ? step : step > 1 ? step - 1 : step;

  return (
    <div className="flex items-center justify-center gap-2 px-1">
      {labels.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
              i === current
                ? "bg-accent-600 text-white"
                : i < current
                  ? "bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-400"
                  : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
            }`}
          >
            {i + 1}
          </span>
          <span
            className={`hidden text-xs sm:inline ${
              i === current ? "font-medium text-slate-900 dark:text-white" : "text-slate-400 dark:text-slate-500"
            }`}
          >
            {label}
          </span>
          {i < labels.length - 1 && <span className="mx-1 h-px w-6 bg-slate-200 dark:bg-slate-800" />}
        </div>
      ))}
    </div>
  );
}

export default function Setup() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [vpnEnabled, setVpnEnabled] = useState(true);
  const [gluetunFields, setGluetunFields] = useState(null);
  const [postgresFields, setPostgresFields] = useState(null);
  const [instanceFields, setInstanceFields] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [createdInstance, setCreatedInstance] = useState(false);

  useEffect(() => {
    api.stackSettings().then((s) => setVpnEnabled(s.vpnEnabled));
  }, []);

  useEffect(() => {
    if (step === 1 && !gluetunFields) api.componentFields("gluetun").then((r) => setGluetunFields(r.fields));
    if (step === 2 && !postgresFields) api.componentFields("postgres").then((r) => setPostgresFields(r.fields));
    if (step === 3 && !instanceFields) api.componentFields("instance").then((r) => setInstanceFields(r.fields));
  }, [step, gluetunFields, postgresFields, instanceFields]);

  function goBack() {
    setError(null);
    if (step === 2 && !vpnEnabled) return setStep(0);
    setStep((s) => Math.max(0, s - 1));
  }

  async function chooseVpn(enabled) {
    setError(null);
    setVpnEnabled(enabled);
    try {
      await api.saveStackSettings({ vpnEnabled: enabled });
      setStep(enabled ? 1 : 2);
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveGluetun(patch) {
    setSaving(true);
    setError(null);
    try {
      await api.saveComponent("gluetun", patch);
      setStep(2);
    } catch (err) {
      setError(err.body?.errors?.map((e) => e.message).join(" ") || err.message);
    } finally {
      setSaving(false);
    }
  }

  async function savePostgres(patch) {
    setSaving(true);
    setError(null);
    try {
      await api.saveComponent("postgres", patch);
      setStep(3);
    } catch (err) {
      setError(err.body?.errors?.map((e) => e.message).join(" ") || err.message);
    } finally {
      setSaving(false);
    }
  }

  async function createInstance(patch) {
    setSaving(true);
    setError(null);
    try {
      await api.createStackInstance(patch);
      setCreatedInstance(true);
      setStep(4);
    } catch (err) {
      setError(err.body?.errors?.map((e) => e.message).join(" ") || err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Layout title="Setup wizard">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Progress step={step} vpnEnabled={vpnEnabled} />

        {step === 0 && (
          <StepCard
            title="Let's set up your stack"
            description="Three things, in the order that makes the rest easiest: a VPN tunnel (optional), a database, and your first IPTV provider. Everything here is also on the Stack page — this just walks through it in order."
          >
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Route traffic through a VPN?</p>
            <p className="mt-1 max-w-prose text-xs text-slate-500 dark:text-slate-400">
              Recommended if your provider restricts access by location or by IP. Every instance shares one
              tunnel — this isn't per-instance. You can change this later under Stack.
            </p>
            {error && (
              <div className="mt-3">
                <ErrorNote message={error} />
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <Button tone="accent" onClick={() => chooseVpn(true)}>
                Yes, use a VPN
              </Button>
              <Button tone="ghost" onClick={() => chooseVpn(false)}>
                No, skip it
              </Button>
            </div>
          </StepCard>
        )}

        {step === 1 && (
          <StepCard
            title="Gluetun (VPN)"
            description="The tunnel every instance's traffic will route through. This container also publishes every instance's port, so it's configured first."
          >
            {gluetunFields === null ? (
              <Loading />
            ) : (
              <SchemaForm
                fields={gluetunFields}
                onSave={saveGluetun}
                saving={saving}
                error={error}
                submitLabel="Save and continue"
              />
            )}
            <BackLink onClick={goBack} />
          </StepCard>
        )}

        {step === 2 && (
          <StepCard
            title="PostgreSQL"
            description="Where every instance keeps its history, VOD index and aliases. Each instance gets its own database, created automatically."
          >
            {postgresFields === null ? (
              <Loading />
            ) : (
              <SchemaForm
                fields={postgresFields}
                onSave={savePostgres}
                saving={saving}
                error={error}
                submitLabel="Save and continue"
              />
            )}
            <BackLink onClick={goBack} />
          </StepCard>
        )}

        {step === 3 && (
          <StepCard
            title="Your first instance"
            description="One IPTV provider account. Its port, API key and address are worked out for you — add more from the Stack page any time."
          >
            {instanceFields === null ? (
              <Loading />
            ) : (
              <SchemaForm
                fields={instanceFields}
                onSave={createInstance}
                saving={saving}
                error={error}
                submitLabel="Create and continue"
              />
            )}
            <div className="mt-3 flex items-center justify-between">
              <BackLink onClick={goBack} />
              <button
                onClick={() => setStep(4)}
                className="text-xs font-medium text-slate-500 hover:underline dark:text-slate-400"
              >
                Skip for now
              </button>
            </div>
          </StepCard>
        )}

        {step === 4 && (
          <Card className="p-6 text-center">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">You're set up</h2>
            <p className="mx-auto mt-2 max-w-prose text-sm text-slate-500 dark:text-slate-400">
              {createdInstance
                ? "Your first instance is configured."
                : "No instance was created — add one from the Stack page whenever you're ready."}{" "}
              Nothing has actually been created on Docker yet: review the plan and apply it to bring the
              containers up.
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <Button tone="accent" onClick={() => navigate("/stack")}>
                Review the stack plan
              </Button>
            </div>
          </Card>
        )}
      </div>
    </Layout>
  );
}

function BackLink({ onClick }) {
  return (
    <button onClick={onClick} className="mt-3 text-xs font-medium text-slate-500 hover:underline dark:text-slate-400">
      Back
    </button>
  );
}
