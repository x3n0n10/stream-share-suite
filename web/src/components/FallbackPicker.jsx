import { useEffect, useState } from "react";
import { FIELD, ErrorNote } from "./common.jsx";
import { api } from "../lib/api.js";
import { parseItems, removeItem, joinItems } from "../lib/listItems.js";
import { moveItem, fallbackChoices } from "../lib/failover.js";

const ROW =
  "flex items-center gap-2 rounded-lg bg-slate-100 py-1 pl-2.5 pr-1 text-xs font-medium " +
  "text-slate-700 dark:bg-slate-800 dark:text-slate-200";
const ICON_BUTTON =
  "rounded-md px-1.5 py-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-30 " +
  "dark:hover:bg-slate-700 dark:hover:text-white";

// Ordered fallback instances, stored as one comma-separated string of keys
// (first = tried first). Loads the instance list and failover support itself;
// until then the add-select offers nothing.
export default function FallbackPicker({ value, onChange, componentKey }) {
  const items = parseItems(value);
  const [instances, setInstances] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [supported, setSupported] = useState(null);

  useEffect(() => {
    let live = true;
    api
      .stackInstances()
      .then((r) => live && (setInstances(r.instances || []), setLoaded(true)))
      .catch((e) => live && setError(e.message || "Could not load instances"));
    api.failoverSupport().then((r) => live && setSupported(r.supported || [])).catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const emit = (next) => onChange(joinItems(next));
  const choices = fallbackChoices(instances, componentKey, items, supported);

  return (
    <div className="flex flex-col gap-2" role="group" aria-label="Fallback instances">
      {items.map((key, i) => {
        const inst = instances.find((x) => x.key === key);
        const name = inst ? inst.displayName : loaded ? `${key} (removed)` : key;
        return (
          <div key={key} className={ROW}>
            <span className="min-w-0 flex-1 truncate">
              {name}
              {inst && supported && !supported.includes(key) && (
                <span className="ml-1.5 font-normal text-amber-600 dark:text-amber-400">
                  needs a newer StreamShare version
                </span>
              )}
            </span>
            <button type="button" className={ICON_BUTTON} disabled={i === 0} aria-label={`Move ${name} up`} onClick={() => emit(moveItem(items, i, -1))}>
              ↑
            </button>
            <button type="button" className={ICON_BUTTON} disabled={i === items.length - 1} aria-label={`Move ${name} down`} onClick={() => emit(moveItem(items, i, 1))}>
              ↓
            </button>
            <button type="button" className={ICON_BUTTON} aria-label={`Remove ${name}`} onClick={() => emit(removeItem(items, key))}>
              ×
            </button>
          </div>
        );
      })}
      <ErrorNote message={error && `Could not load instances: ${error}`} />
      <select
        className={`${FIELD} !w-auto !py-1`}
        aria-label="Add fallback instance"
        value=""
        disabled={choices.length === 0 || !loaded}
        onChange={(e) => e.target.value && emit([...items, e.target.value])}
      >
        <option value="">{!loaded && !error ? "Loading…" : choices.length === 0 ? "No instance to add" : "Add fallback…"}</option>
        {choices.map((c) => (
          <option key={c.key} value={c.key}>
            {c.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}
