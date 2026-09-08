import { Card, Button } from "../../components/common.jsx";

const HIGHLIGHTS = [
  "Add your IPTV provider(s) as instances — each gets its own container, database and API key, set up for you.",
  "Turn on VOD caching and catchup buffering, per instance.",
  "Make an instance reachable from outside your network, with HTTPS handled automatically if you want it.",
  "Route everything through a VPN, shared across every instance.",
  "Watch instance health and have the VPN reconnect itself when a provider blocks it.",
];

export default function StepWelcome({ onNext }) {
  return (
    <Card className="p-6 text-center">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">Welcome</h2>
      <p className="mx-auto mt-2 max-w-prose text-sm text-slate-500 dark:text-slate-400">
        A few short steps get StreamShare Suite fully configured — no compose file to hand-edit, no
        container names to remember. Answer what you know; anything you leave blank keeps a sensible
        default, and everything here can be changed again later from Settings or the Stack page.
      </p>

      <ul className="mx-auto mt-5 flex max-w-md flex-col gap-2 text-left text-sm text-slate-600 dark:text-slate-300">
        {HIGHLIGHTS.map((text) => (
          <li key={text} className="flex gap-2">
            <span className="mt-0.5 text-accent-500">•</span>
            <span>{text}</span>
          </li>
        ))}
      </ul>

      <p className="mx-auto mt-5 max-w-prose text-xs text-slate-400 dark:text-slate-500">
        Nothing is actually created on Docker until you reach the end and apply the plan from the
        Stack page — walk through as many or as few steps as you like, and come back anytime to pick
        up where you left off.
      </p>

      <div className="mt-5 flex items-center justify-center gap-2 border-t border-slate-200 pt-5 dark:border-slate-800">
        <Button tone="accent" onClick={() => onNext("portRange")}>
          Get started
        </Button>
      </div>
    </Card>
  );
}
