import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import StepInstances from "./setup/StepInstances.jsx";
import StepCaching from "./setup/StepCaching.jsx";
import StepDatabase from "./setup/StepDatabase.jsx";
import StepExternalAccess from "./setup/StepExternalAccess.jsx";
import StepVpn from "./setup/StepVpn.jsx";
// TODO(task 14): uncomment when StepHealthCheck.jsx exists
// import StepHealthCheck from "./setup/StepHealthCheck.jsx";
import StepDone from "./setup/StepDone.jsx";

// Each step decides for itself where "next" goes (StepVpn skips
// StepHealthCheck when the VPN is off), so this is a lookup by id rather
// than a fixed-index array — see each step's own onNext call for the
// sequencing decision that actually matters.
const STEP_LABELS = {
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
  const [step, setStep] = useState("instances");
  // { key, port, displayName } per instance created this run — later steps
  // (caching, access, health) both read and patch entries here.
  const [instances, setInstances] = useState([]);

  const stepProps = { instances, setInstances, onNext: setStep, onBack: setStep };

  return (
    <Layout title="Setup wizard">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Progress step={step} />

        {step === "instances" && <StepInstances {...stepProps} />}
        {step === "caching" && <StepCaching {...stepProps} />}
        {step === "database" && <StepDatabase {...stepProps} />}
        {step === "access" && <StepExternalAccess {...stepProps} />}
        {step === "vpn" && <StepVpn {...stepProps} />}
        {/* TODO(task 14): uncomment when StepHealthCheck.jsx exists */}
        {/* {step === "health" && <StepHealthCheck {...stepProps} />} */}
        {step === "done" && <StepDone navigate={navigate} />}
      </div>
    </Layout>
  );
}
