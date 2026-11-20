import { useCallback, useEffect, useState } from "react";
import { FIELD, ErrorNote } from "./common.jsx";
import { api } from "../lib/api.js";
import { parseItems, removeItem, joinItems } from "../lib/listItems.js";
import { moveItem, fallbackChoices, unsupportedReason, needsRecheck } from "../lib/failover.js";

const ROW =
  "flex items-center gap-2 rounded-lg bg-slate-100 py-1 pl-2.5 pr-1 text-xs font-medium " +
  "text-slate-700 dark:bg-slate-800 dark:text-slate-200";
const ICON_BUTTON =
  "rounded-md px-1.5 py-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-30 " +
  "dark:hover:bg-slate-700 dark:hover:text-white";

// Ordered fallback instances, stored as one comma-separated string of keys
// (first = tried first). Loads the instance list and failover support itself;
// until then the add-select offers nothing. Support is checked again when the
// tab regains focus, and every few seconds while some instance cannot be
// picked yet (still starting after Apply), so the list never goes stale.
export default function FallbackPicker({ value, onChange, componentKey }) {
  const items = parseItems(value);
  const [instances, setInstances] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [support, setSupport] = useState(null);

  useEffect(() => {
    let live = true;
    api
      .stackInstances()
      .then((r) => live && (setInstances(r.instances || []), setLoaded(true)))
      .catch((e) => live && setError(e.message || "Could not load instances"));
    return () => {
      live = false;
    };
  }, []);

  const checkSupport = useCallback(() => {
    api.failoverSupport().then(setSupport).catch(() => {});
  }, []);
  useEffect(() => {
    checkSupport();
    window.addEventListener("focus", checkSupport);
    return () => window.removeEventListener("focus", checkSupport);
  }, [checkSupport]);

  const waiting = needsRecheck(instances, componentKey, support);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(checkSupport, 5000);
    return () => clearInterval(timer);
  }, [waiting, checkSupport]);

  const emit = (next) => onChange(joinItems(next));
  const choices = fallbackChoices(instances, componentKey, items, support);
  let placeholder = "Add fallback…";
  if (!loaded && !error) placeholder = "Loading…";
  else if (choices.length === 0) placeholder = "No instance to add";
  else if (choices.every((c) => c.reason)) placeholder = "No instance to add yet";

  return (
    <div className="flex flex-col gap-2" role="group" aria-label="Fallback instances">
      {items.map((key, i) => {
        const inst = instances.find((x) => x.key === key);
        const name = inst ? inst.displayName : loaded ? `${key} (removed)` : key;
        const reason = inst && unsupportedReason(key, support);
        return (
          <div key={key} className={ROW}>
            <span className="min-w-0 flex-1 truncate">
              {name}
              {reason && <span className="ml-1.5 font-normal text-amber-600 dark:text-amber-400">{reason}</span>}
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
        <option value="">{placeholder}</option>
        {choices.map((c) => (
          <option key={c.key} value={c.key} disabled={Boolean(c.reason)}>
            {c.reason ? `${c.displayName} (${c.reason})` : c.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}
