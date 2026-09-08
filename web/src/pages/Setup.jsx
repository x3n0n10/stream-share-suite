import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import { Button } from "../components/common.jsx";
import { api } from "../lib/api.js";
import StepPortRange from "./setup/StepPortRange.jsx";
import StepInstances from "./setup/StepInstances.jsx";
import StepCaching from "./setup/StepCaching.jsx";
import StepDatabase from "./setup/StepDatabase.jsx";
import StepExternalAccess from "./setup/StepExternalAccess.jsx";
import StepVpn from "./setup/StepVpn.jsx";
import StepHealthCheck from "./setup/StepHealthCheck.jsx";
import StepDone from "./setup/StepDone.jsx";

// Each step decides for itself where "next" goes (StepVpn skips
// StepHealthCheck when the VPN is off), so this is a lookup by id rather
// than a fixed-index array — see each step's own onNext call for the
// sequencing decision that actually matters.
const STEP_LABELS = {
  portRange: "Port range",
  instances: "Instances",
  caching: "Caching",
  database: "Database",
  access: "External access",
  vpn: "VPN",
  health: "Health check",
  done: "Done",
};

function Progress({ step }) {
  const order = Object.keys(STEP_LABELS);
  const current = order.indexOf(step);

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 px-1">
      {order.map((id, i) => (
        <div key={id} className="flex items-center gap-2">
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
            {STEP_LABELS[id]}
          </span>
          {i < order.length - 1 && <span className="mx-1 h-px w-6 bg-slate-200 dark:bg-slate-800" />}
        </div>
      ))}
    </div>
  );
}

export default function Setup() {
  const navigate = useNavigate();
  const [step, setStep] = useState("portRange");
  // The steps actually visited, in order — not a fixed prior-in-STEP_LABELS
  // lookup, because the sequence itself branches (StepVpn skips StepHealthCheck
  // when the VPN is off). Back has to retrace what really happened, not the
  // display order.
  const [history, setHistory] = useState([]);
  // Every existing instance, plus any created later in this run via
  // StepInstances's own setInstances calls — every other step reads this
  // same list, which is what makes the whole wizard idempotent rather than
  // "first run only."
  const [instances, setInstances] = useState([]);

  useEffect(() => {
    api.stackInstances().then((r) => setInstances(r.instances));
  }, []);

  function goNext(nextStep) {
    setHistory((h) => [...h, step]);
    setStep(nextStep);
  }

  function goBack() {
    if (history.length === 0) return;
    setStep(history[history.length - 1]);
    setHistory(history.slice(0, -1));
  }

  const stepProps = { instances, setInstances, onNext: goNext };

  return (
    <Layout title="Setup wizard">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Progress step={step} />

        {history.length > 0 && (
          <div>
            <Button tone="ghost" onClick={goBack}>
              Back
            </Button>
          </div>
        )}

        {step === "portRange" && <StepPortRange {...stepProps} />}
        {step === "instances" && <StepInstances {...stepProps} />}
        {step === "caching" && <StepCaching {...stepProps} />}
        {step === "database" && <StepDatabase {...stepProps} />}
        {step === "access" && <StepExternalAccess {...stepProps} />}
        {step === "vpn" && <StepVpn {...stepProps} />}
        {step === "health" && <StepHealthCheck {...stepProps} />}
        {step === "done" && <StepDone navigate={navigate} />}
      </div>
    </Layout>
  );
}
