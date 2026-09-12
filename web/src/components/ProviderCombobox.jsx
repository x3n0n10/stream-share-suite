import { useMemo, useState } from "react";
import { FIELD } from "./common.jsx";

// A free-text input with a filtered dropdown of field.options — unlike the
// "select" type's button row, typing a value not in the list is accepted as
// the field's value as-is (see gluetun.js's PROVIDER_LABELS comment: a
// provider not in the list still works, this only saves the common case
// from needing gluetun's exact spelling). Selecting a known option surfaces
// its field.optionNotes entry, if any, below the input.
export default function ProviderCombobox({ field, value, onChange }) {
  const [open, setOpen] = useState(false);
  const options = field.options || [];
  const optionLabels = field.optionLabels || {};
  const optionNotes = field.optionNotes || {};

  const query = (value ?? "").toLowerCase();
  const matches = useMemo(() => {
    if (!query) return options;
    return options.filter(
      (opt) => opt.toLowerCase().includes(query) || (optionLabels[opt] || "").toLowerCase().includes(query),
    );
  }, [options, optionLabels, query]);

  const note = optionNotes[query];

  return (
    <div className="relative">
      <input
        className={FIELD}
        type="text"
        value={value ?? ""}
        onChange={(e) => onChange(field.key, e.target.value)}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        autoComplete="off"
        placeholder="Start typing to search…"
      />
      {open && matches.length > 0 && (
        <div className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {matches.map((opt) => (
            <button
              key={opt}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(field.key, opt);
                setOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-accent-50 dark:text-slate-200 dark:hover:bg-accent-900/30"
            >
              {optionLabels[opt] || opt}
            </button>
          ))}
        </div>
      )}
      {note && <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{note}</p>}
    </div>
  );
}
