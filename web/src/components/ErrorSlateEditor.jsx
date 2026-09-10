import { useState } from "react";
import { FIELD } from "./common.jsx";
import { IconTrash } from "./Icons.jsx";

// A structured row editor over the same JSON shape ERROR_SLATE_MESSAGES_FILE
// expects — {"<code or UNREACHABLE>": {message, meaning?}} — so the value
// this hands back to SchemaForm's draft is still that same JSON string;
// nothing downstream (the "errorSlates"/json:true field, or reconcile's
// file write) needs to know the value came from rows instead of free text.
function parseRows(json) {
  try {
    const obj = JSON.parse(json || "{}");
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
    return Object.entries(obj).map(([code, v]) => ({
      code,
      meaning: v?.meaning || "",
      message: v?.message || "",
    }));
  } catch {
    return [];
  }
}

function rowsToJson(rows) {
  const obj = {};
  for (const row of rows) {
    const code = row.code.trim();
    const message = row.message.trim();
    if (!code && !message) continue; // an abandoned blank row, not an entry
    obj[code] = row.meaning.trim() ? { meaning: row.meaning.trim(), message } : { message };
  }
  return JSON.stringify(obj);
}

function Label({ children }) {
  return <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{children}</span>;
}

// Alongside any numeric HTTP status code, stream-share also accepts these
// synthetic codes for connection-level failures that never got a status code
// in the first place.
const SYNTHETIC_CODES = ["UNREACHABLE", "TIMEOUT", "DNS", "TLS"];
const CODE_LIST_ID = "error-slate-synthetic-codes";

export default function ErrorSlateEditor({ value, onChange }) {
  const [rows, setRows] = useState(() => parseRows(value));

  function commit(next) {
    setRows(next);
    onChange(rowsToJson(next));
  }

  function setRow(i, patch) {
    commit(rows.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.length === 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500">
          No overrides — every code shows its default message.
        </p>
      )}
      {rows.map((row, i) => (
        <div key={i} className="flex items-start gap-2 rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
          <div className="grid flex-1 gap-2 sm:grid-cols-[7rem_1fr_2fr]">
            <label className="flex flex-col gap-1">
              <Label>
                Code<span className="text-rose-500"> *</span>
              </Label>
              <input
                className={`${FIELD} font-mono text-xs`}
                placeholder="404, UNREACHABLE"
                list={CODE_LIST_ID}
                required
                value={row.code}
                onChange={(e) => setRow(i, { code: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <Label>Meaning (optional)</Label>
              <input
                className={`${FIELD} text-xs`}
                placeholder="Channel problem"
                value={row.meaning}
                onChange={(e) => setRow(i, { meaning: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <Label>
                Message shown to viewers<span className="text-rose-500"> *</span>
              </Label>
              <input
                className={`${FIELD} text-xs`}
                placeholder="This channel doesn't exist anymore."
                required
                value={row.message}
                onChange={(e) => setRow(i, { message: e.target.value })}
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => commit(rows.filter((_, idx) => idx !== i))}
            aria-label="Remove"
            title="Remove"
            className="mt-4 shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20 dark:hover:text-rose-400"
          >
            <IconTrash className="h-4 w-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => commit([...rows, { code: "", meaning: "", message: "" }])}
        className="self-start rounded-lg px-3 py-1.5 text-xs font-medium text-accent-600 hover:bg-accent-50 dark:text-accent-400 dark:hover:bg-accent-900/20"
      >
        + Add entry
      </button>
      <datalist id={CODE_LIST_ID}>
        {SYNTHETIC_CODES.map((code) => (
          <option key={code} value={code} />
        ))}
      </datalist>
    </div>
  );
}
