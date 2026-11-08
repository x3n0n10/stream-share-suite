import { useEffect, useRef, useState } from "react";
import { FIELD } from "./common.jsx";
import { api } from "../lib/api.js";

// The health-check wizard's channel search, in the shape the picker uses.
async function searchHealthCheckChannels(instanceKey, query) {
  const { results } = await api.healthCheckChannels(instanceKey, query);
  return (results || []).map((r) => ({ id: r.StreamID, name: r.Name, category: r.Category }));
}

// A stream-ID text field that also offers search-as-you-type suggestions
// from an instance's own channel index (see the health-check spec) — shared
// by the setup wizard's health-check step and the Stack page's instance edit
// form, so the debounce/stale-response guard/dismiss logic lives in exactly
// one place rather than being duplicated (and re-bugged) per call site.
//
// Stays a fully working plain text field with no dropdown when instanceKey
// is missing (e.g. the "add instance" form, before the instance exists) or
// the search itself fails — api.healthCheckChannels never throws in a way
// that should block typing, it just means no suggestions.
//
// A picked suggestion fills the field with "<StreamID>.ts", matching the
// extension stream-share's own examples use for a probe channel id.
//
// Other pickers reuse the same field through three optional props:
//   search(query)  -> Promise<[{ id, name, category? }]>, instead of the
//                     health-check channel search
//   pickValue(m)   -> the text a pick puts in the field (default "<id>.ts")
//   onPick(m)      -> called after a pick, so the caller can keep the id
export default function ChannelSearchInput({
  instanceKey,
  value,
  onChange,
  placeholder,
  autoFocus,
  search,
  pickValue,
  onPick,
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [pickedCaption, setPickedCaption] = useState("");
  const debounceTimer = useRef(null);
  const latestRequest = useRef(0);

  useEffect(() => {
    // Cancel any in-flight debounce on unmount, e.g. navigating away mid-type.
    return () => clearTimeout(debounceTimer.current);
  }, []);

  function handleChange(next) {
    onChange(next);
    setPickedCaption("");
    clearTimeout(debounceTimer.current);

    const query = next.trim();
    if (!query || !instanceKey) {
      latestRequest.current += 1; // supersede any in-flight request
      setSuggestions([]);
      return;
    }
    debounceTimer.current = setTimeout(async () => {
      const seq = ++latestRequest.current;
      try {
        const matches = await (search ? search(query) : searchHealthCheckChannels(instanceKey, query));
        if (latestRequest.current !== seq) return; // a newer query already answered
        setSuggestions(matches || []);
      } catch (err) {
        if (latestRequest.current !== seq) return;
        console.warn(`Channel search failed for ${instanceKey}:`, err.message);
        setSuggestions([]);
      }
    }, 300);
  }

  function pick(match) {
    clearTimeout(debounceTimer.current);
    latestRequest.current += 1; // supersede any in-flight request
    onChange(pickValue ? pickValue(match) : `${match.id}.ts`);
    setPickedCaption(match.category ? `${match.category} — ${match.name}` : match.name);
    setSuggestions([]);
    onPick?.(match);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <input
          className={FIELD}
          type="text"
          value={value ?? ""}
          onChange={(e) => handleChange(e.target.value)}
          // preventDefault on the suggestion button's mousedown (below) stops
          // this blur from ever firing on a pick, so closing here can be
          // immediate — no timing hack needed for "click a suggestion" to
          // still work (compare ProviderCombobox.jsx, same pattern).
          onBlur={() => setSuggestions([])}
          onKeyDown={(e) => {
            if (e.key === "Escape") setSuggestions([]);
          }}
          placeholder={placeholder}
          autoComplete="off"
          autoFocus={autoFocus}
        />
        {suggestions.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
            {suggestions.map((match, i) => (
              <li key={`${match.id}-${i}`}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(match)}
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <span className="text-slate-900 dark:text-white">
                    {match.category ? `${match.category} — ` : ""}
                    {match.name}
                  </span>
                  <span className="text-xs text-slate-400">{match.id}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {pickedCaption && (
        <span className="text-xs text-slate-500 dark:text-slate-400">Selected: {pickedCaption}</span>
      )}
    </div>
  );
}
