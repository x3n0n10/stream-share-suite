import { useEffect, useRef, useState } from "react";
import { FIELD } from "./common.jsx";
import { api } from "../lib/api.js";

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
export default function ChannelSearchInput({ instanceKey, value, onChange, placeholder, autoFocus }) {
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
        const { results } = await api.healthCheckChannels(instanceKey, query);
        if (latestRequest.current !== seq) return; // a newer query already answered
        setSuggestions(results || []);
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
    onChange(`${match.StreamID}.ts`);
    setPickedCaption(match.Category ? `${match.Category} — ${match.Name}` : match.Name);
    setSuggestions([]);
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
              <li key={`${match.StreamID}-${i}`}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(match)}
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <span className="text-slate-900 dark:text-white">
                    {match.Category ? `${match.Category} — ` : ""}
                    {match.Name}
                  </span>
                  <span className="text-xs text-slate-400">{match.StreamID}</span>
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
