import { useState } from "react";
import { usePolling } from "../lib/usePolling.js";
import { api } from "../lib/api.js";
import { IconChevronDown } from "./Icons.jsx";

const REFRESH_MS = 60_000;
const EXPANDED_KEY = "layout.versionsExpanded";

// How a row's version reads. Values that only say what the image is (rather
// than what the software reports) are muted so a real version stands out.
function versionText(row) {
  if (row.status === "stopped") return { text: "stopped", muted: true };
  if (!row.version) return { text: "unknown", muted: true };
  if (row.source === "image-id") return { text: `image ${row.version}`, muted: true };
  return { text: row.version, muted: false };
}

function Row({ label, text, muted, running }) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1.5">
        {running !== undefined && (
          <span
            title={running ? "running" : "not running"}
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              running ? "bg-accent-500" : "bg-slate-300 dark:bg-slate-600"
            }`}
          />
        )}
        <span className="truncate text-slate-600 dark:text-slate-400">{label}</span>
      </span>
      <span
        className={`shrink-0 font-mono ${
          muted ? "text-slate-400 dark:text-slate-500" : "text-slate-800 dark:text-slate-200"
        }`}
      >
        {text}
      </span>
    </li>
  );
}

// Informational only: if a poll fails usePolling keeps the last data, and
// with none there is simply nothing to show, never an error banner.
export default function VersionBlock() {
  const { data } = usePolling(() => api.stackVersions(), REFRESH_MS);
  // Collapsed by default — most visits just want to confirm the Suite is on
  // the version they think it is, not read every component's. Persisted like
  // the sidebar's own collapse state, so it stays open for someone who wants
  // it open.
  const [expanded, setExpanded] = useState(() => localStorage.getItem(EXPANDED_KEY) === "1");

  function toggle() {
    setExpanded((prev) => {
      const next = !prev;
      localStorage.setItem(EXPANDED_KEY, next ? "1" : "0");
      return next;
    });
  }

  if (!data) return null;

  return (
    // The nav above never shrinks below its content, so this block is what
    // gives up height on a short screen (min-h-0 + a scrolling list) rather
    // than pushing Sign out off the bottom.
    <div className="flex min-h-0 shrink flex-col px-3 pt-4">
      <div className="flex min-h-0 flex-col rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800/50">
        <button
          onClick={toggle}
          aria-expanded={expanded}
          className="flex shrink-0 items-center justify-between gap-2"
        >
          <span className="truncate text-slate-600 dark:text-slate-400">Suite</span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span
              className={`font-mono ${
                data.suite.version ? "text-slate-800 dark:text-slate-200" : "text-slate-400 dark:text-slate-500"
              }`}
            >
              {data.suite.version || "unknown"}
            </span>
            <IconChevronDown
              className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform dark:text-slate-500 ${
                expanded ? "" : "-rotate-90"
              }`}
            />
          </span>
        </button>
        {expanded && (
          <ul className="mt-2 min-h-0 max-h-40 space-y-1 overflow-y-auto border-t border-slate-200 pt-2 dark:border-slate-700">
            {(data.components ?? []).map((row) => {
              const { text, muted } = versionText(row);
              return (
                <Row
                  key={`${row.kind}:${row.key}`}
                  label={row.label}
                  text={text}
                  muted={muted}
                  running={row.status === "running"}
                />
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
