import { usePolling } from "../lib/usePolling.js";
import { api } from "../lib/api.js";

const REFRESH_MS = 60_000;

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
  if (!data) return null;

  return (
    <div className="px-4 pt-4">
      <div className="rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800/50">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Versions
        </p>
        <ul className="max-h-40 space-y-1 overflow-y-auto">
          <Row label="Suite" text={data.suite.version} muted={false} />
          {data.components.map((row) => {
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
      </div>
    </div>
  );
}
