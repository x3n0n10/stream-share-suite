import { useState } from "react";
import { FIELD } from "./common.jsx";
import { parseItems, addItems, removeItem, joinItems } from "../lib/listItems.js";

const CHIP =
  "inline-flex items-center gap-1 rounded-lg bg-slate-100 py-1 pl-2.5 pr-1 text-xs font-medium " +
  "text-slate-700 dark:bg-slate-800 dark:text-slate-200";
const SMALL_BUTTON =
  "rounded-lg px-2.5 py-1 text-xs font-medium text-accent-700 hover:bg-slate-100 " +
  "dark:text-accent-400 dark:hover:bg-slate-800";

// Edits one comma-separated string as a row of removable chips. The string
// stays the source of truth (value in, value out), so callers keep their
// existing storage and API shapes.
export default function ListInput({ value, onChange, itemType = "text", sort = false, placeholder, ariaLabel }) {
  const items = parseItems(value);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false); // time mode: entry input is hidden until "+ Add time"
  const opts = { itemType, sort };

  function emit(next) {
    onChange(joinItems(next));
  }

  function commit(raw) {
    emit(addItems(items, raw, opts));
    setDraft("");
    setAdding(false);
  }

  function onKeyDown(e) {
    if (e.key === "Enter" || (e.key === "," && itemType !== "time")) {
      e.preventDefault();
      if (draft) commit(draft);
    } else if (e.key === "Escape") {
      setDraft("");
      setAdding(false);
    } else if (e.key === "Backspace" && !draft && items.length > 0 && itemType !== "time") {
      // Not in time mode: backspace there clears segments of a half-filled picker (draft stays "").
      emit(items.slice(0, -1));
    }
  }

  function onChangeText(e) {
    const text = e.target.value;
    // A paste of "a,b,c" (or a typed comma on a text field) becomes chips at once.
    if (text.includes(",")) commit(text);
    else setDraft(itemType === "number" ? text.replace(/\D/g, "") : text);
  }

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label={ariaLabel} role="group">
      {items.map((item) => (
        <span key={item} className={CHIP}>
          {item}
          <button
            type="button"
            onClick={() => emit(removeItem(items, item))}
            aria-label={`Remove ${item}`}
            className="rounded-md px-1.5 py-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-white"
          >
            ×
          </button>
        </span>
      ))}

      {itemType === "time" ? (
        adding ? (
          <span className="inline-flex items-center gap-1">
            <input
              autoFocus
              type="time"
              className={`${FIELD} !w-auto !py-1`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button type="button" className={SMALL_BUTTON} onClick={() => draft && commit(draft)}>
              Add
            </button>
          </span>
        ) : (
          <button type="button" className={SMALL_BUTTON} onClick={() => setAdding(true)}>
            + Add time
          </button>
        )
      ) : (
        <input
          className={`${FIELD} !w-auto min-w-[10rem] flex-1 !py-1`}
          value={draft}
          inputMode={itemType === "number" ? "numeric" : undefined}
          placeholder={items.length === 0 ? placeholder : "Add…"}
          onChange={onChangeText}
          onKeyDown={onKeyDown}
          onBlur={() => draft && commit(draft)}
        />
      )}
    </div>
  );
}
