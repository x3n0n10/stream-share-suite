import { useState } from "react";
import { Card, Button, ErrorNote } from "../../components/common.jsx";
import { api } from "../../lib/api.js";

const IMPORT_KIND_LABEL = {
  gluetun: "Gluetun (VPN)",
  postgres: "PostgreSQL",
  instance: "StreamShare instance",
};

// Distinct from adoption, which the plan already shows on its own: adopting
// only ever means "leave this container running, untouched" — it never
// fills in the Suite's own configuration for it, so an adopted component's
// form stays blank until someone types into it. This is what actually reads
// a real container's env, image and networks back into that configuration.
// A scan is a real Docker API call, so it only runs when asked for rather
// than on every page load the way the plan does.
export default function ImportTab({ onImported }) {
  const [scanned, setScanned] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [importingId, setImportingId] = useState(null);
  const [error, setError] = useState(null);

  async function scan() {
    setScanning(true);
    setError(null);
    try {
      const res = await api.importCandidates();
      setCandidates(res.candidates);
      setScanned(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setScanning(false);
    }
  }

  async function doImport(candidate) {
    setImportingId(candidate.containerId);
    setError(null);
    try {
      await api.importCandidate(candidate.containerId, candidate.kind);
      setCandidates((prev) => prev.filter((c) => c.containerId !== candidate.containerId));
      await onImported();
    } catch (err) {
      setError(`${candidate.name}: ${err.message}`);
    } finally {
      setImportingId(null);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Import from running containers
          </h2>
          <p className="mt-1 max-w-prose text-xs text-slate-500 dark:text-slate-400">
            Finds gluetun, PostgreSQL and StreamShare containers already running outside the Suite
            and reads their real configuration in, instead of retyping it by hand. The containers
            themselves are never touched.
          </p>
        </div>
        <Button tone="ghost" onClick={scan} loading={scanning} disabled={scanning}>
          {scanned ? "Scan again" : "Scan for existing containers"}
        </Button>
      </div>

      {error && (
        <div className="px-5 pt-4">
          <ErrorNote message={error} />
        </div>
      )}

      {scanned && candidates.length === 0 && !error && (
        <p className="px-5 py-6 text-sm text-slate-500 dark:text-slate-400">
          Nothing found that isn't already part of the stack.
        </p>
      )}

      {candidates.length > 0 && (
        <ul>
          {candidates.map((candidate) => (
            <li
              key={candidate.containerId}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3 last:border-b-0 dark:border-slate-800"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                  {candidate.name}
                </p>
                <p className="mt-0.5 truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                  {IMPORT_KIND_LABEL[candidate.kind] || candidate.kind} · {candidate.image}
                </p>
              </div>
              <Button
                tone="accent"
                onClick={() => doImport(candidate)}
                loading={importingId === candidate.containerId}
                disabled={importingId !== null}
              >
                Import
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
