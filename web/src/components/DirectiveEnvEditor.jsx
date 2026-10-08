import { useEffect, useMemo } from "react";
import { FIELD } from "./common.jsx";

// One write-only box per {env.NAME} the current directive references,
// instead of a free-text KEY=VALUE textarea — the same idea as
// ErrorSlateEditor: a structured editor over one field's plain-string value.
//
// `value` is this field's own draft value (KEY=VALUE lines) — like any other
// secret field it arrives as "" whenever the form doesn't already hold an
// unsaved edit, because a secret's stored content is never sent back to the
// browser (see registry.js's toPublicFields). `namesSet` carries the one
// thing the server will say about each name: whether it has a stored value,
// never the value itself — same guarantee as valueSet on every other secret
// field, just at per-name granularity instead of whole-field.
//
// `directive` is the live sibling field's value, threaded down through
// SchemaForm's draft — this editor has no server round-trip of its own.
//
// Removing a name from the directive (or clearing it entirely) doesn't by
// itself touch a box for that name — there's no keystroke here to catch it,
// and once the box disappears there's nothing left to type into. So a
// useEffect below proactively prunes any stored name that's no longer
// referenced whenever the directive or value changes, rather than relying on
// the user to revisit a remaining box. It only fires when there's something
// real to prune, so an untouched field (still its pristine "") is never
// marked dirty by an unrelated directive edit.

const ENV_REF = /\{env\.([A-Za-z0-9_]+)\}/g;

function parseValue(raw) {
  const values = {};
  for (const line of String(raw || "").split("\n")) {
    const idx = line.indexOf("=");
    if (idx > 0) values[line.slice(0, idx).trim()] = line.slice(idx + 1);
  }
  return values;
}

function detectNames(directive) {
  return [...new Set([...String(directive || "").matchAll(ENV_REF)].map((m) => m[1]))];
}

export default function DirectiveEnvEditor({ value, directive, onChange, namesSet }) {
  const names = useMemo(() => detectNames(directive), [directive]);
  const values = useMemo(() => parseValue(value), [value]);

  useEffect(() => {
    if (Object.keys(values).some((name) => !names.includes(name))) {
      onChange(names.map((n) => `${n}=${values[n] ?? ""}`).join("\n"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directive, value]);

  function setName(name, next) {
    // Only currently-referenced names are ever written back — the effect
    // above handles the case where a name drops out from under an untouched
    // box.
    const merged = { ...values, [name]: next };
    onChange(names.map((n) => `${n}=${merged[n] ?? ""}`).join("\n"));
  }

  if (names.length === 0) {
    return (
      <p className="text-xs text-slate-400 dark:text-slate-500">
        Reference a credential in Directive above as {"{env.NAME}"} to get a box for it here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {names.map((name) => (
        <label key={name} className="flex flex-col gap-1">
          <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{name}</span>
          <input
            className={FIELD}
            type="password"
            autoComplete="new-password"
            placeholder={namesSet?.[name] ? "••••••••  (unchanged)" : ""}
            value={values[name] ?? ""}
            onChange={(e) => setName(name, e.target.value)}
          />
          <span className="text-[11px] text-slate-400 dark:text-slate-500">
            {namesSet?.[name] ? "Set. Leave blank to keep it." : "Not set."}
          </span>
        </label>
      ))}
    </div>
  );
}
