import { useEffect, useMemo, useState } from "react";
import { Button, ErrorNote, FIELD } from "./common.jsx";
import ErrorSlateEditor from "./ErrorSlateEditor.jsx";
import ProviderCombobox from "./ProviderCombobox.jsx";

// Renders a form from field metadata rather than hand-coded JSX — this is
// the point of the schema registry: a new field on the server is a new row
// in the rendered form with no frontend change at all. Everything here is
// generic over shape; a component's meaning lives entirely in its schema.
export default function SchemaForm({
  fields,
  onSave,
  saving,
  error,
  submitLabel = "Save",
  preview,
  secondaryAction,
  extraOptions,
}) {
  const [draft, setDraft] = useState(() => initialDraft(fields));

  // fields only changes reference when a caller hands in a fresh copy after
  // its own server round-trip (initial load, or an action like "use provider
  // credentials" that edits stored values out from under the open form) —
  // never as a side effect of typing, which only touches draft. Re-sync then,
  // so the inputs reflect what's actually stored instead of stale keystrokes.
  useEffect(() => {
    setDraft(initialDraft(fields));
  }, [fields]);

  const groups = useMemo(() => groupFields(fields), [fields]);

  // Mirrors registry.js's conditionMet/isVisible on the server — see that
  // file for why a condition can also be { any: [...] }. No shared module
  // between client and server here, same as containerName.js's preview logic
  // already isn't; this is a preview of the same rule, not a second source
  // of truth the server would ever defer to.
  function conditionMet(condition) {
    if ("any" in condition) return condition.any.some(conditionMet);
    const depValue = draft[condition.key];
    return "oneOf" in condition ? condition.oneOf.includes(depValue) : depValue === condition.equals;
  }

  function isVisible(field) {
    if (!field.dependsOn) return true;
    const conditions = Array.isArray(field.dependsOn) ? field.dependsOn : [field.dependsOn];
    return conditions.every(conditionMet);
  }

  function set(key, value) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function submit(event) {
    event.preventDefault();
    const patch = {};
    for (const field of fields) {
      if (!isVisible(field)) continue;
      if (field.secret) {
        // Empty means "leave it alone" — the write-only convention. Only a
        // non-empty edit is sent, so a form left untouched never clears a
        // secret that was already set.
        if (draft[field.key]) patch[field.key] = draft[field.key];
        continue;
      }
      patch[field.key] = field.type === "checkbox" ? !!draft[field.key] : draft[field.key];
    }
    onSave(patch);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      {groups.map(([groupName, groupFieldList]) => {
        const visible = groupFieldList.filter(isVisible);
        const basic = visible.filter((f) => !f.advanced);
        const advanced = visible.filter((f) => f.advanced);
        if (visible.length === 0) return null;

        return (
          <div key={groupName || "_"} className="flex flex-col gap-3">
            {groupName && (
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {groupName}
              </h3>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {basic.map((field) => (
                <FieldInput
                  key={field.key}
                  field={field}
                  value={draft[field.key]}
                  onChange={set}
                  extra={extraOptions?.[field.key]}
                />
              ))}
            </div>
            {advanced.length > 0 && (
              <details className="group">
                <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                  Advanced
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {advanced.map((field) => (
                    <FieldInput key={field.key} field={field} value={draft[field.key]} onChange={set} />
                  ))}
                </div>
              </details>
            )}
          </div>
        );
      })}

      {preview && preview(draft)}

      {error && <ErrorNote message={error} />}

      {secondaryAction ? (
        <div className="flex items-center gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
          {secondaryAction}
          <div className="ml-auto">
            <Button type="submit" tone="accent" loading={saving} disabled={saving}>
              {submitLabel}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button type="submit" tone="accent" loading={saving} disabled={saving}>
            {submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}

function FieldInput({ field, value, onChange, extra }) {
  const hint = field.secret
    ? field.valueSet
      ? "Set. Leave blank to keep it."
      : "Not set."
    : field.help;

  // A <label> wraps a single control by convention — fine for a lone
  // input/textarea/checkbox, but a select field is really a row of several
  // buttons (and errorSlates a whole editor of its own inputs/buttons), and
  // some browsers (Safari) paint a hover highlight across a whole label's box
  // when any of several wrapped controls is hovered. A plain <div> sidesteps
  // that; it was never a real <label>/<input> pairing for either.
  const multiControl = field.type === "select" || field.type === "errorSlates" || field.type === "combobox";
  const Wrapper = multiControl ? "div" : "label";

  return (
    <Wrapper
      className={`flex flex-col gap-1.5 ${
        field.type === "textarea" || field.type === "checkbox" || multiControl ? "sm:col-span-2" : ""
      }`}
    >
      <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
        {field.label}
        {field.required && <span className="text-rose-500"> *</span>}
      </span>
      {renderControl(field, value, onChange, extra)}
      {hint && <span className="text-[11px] text-slate-400 dark:text-slate-500">{hint}</span>}
    </Wrapper>
  );
}

function renderControl(field, value, onChange, extra) {
  if (field.type === "textarea") {
    return (
      <textarea
        className={`${FIELD} min-h-[88px] font-mono text-xs`}
        value={value ?? ""}
        placeholder="KEY=VALUE"
        onChange={(e) => onChange(field.key, e.target.value)}
      />
    );
  }

  if (field.type === "errorSlates") {
    return <ErrorSlateEditor value={value} onChange={(next) => onChange(field.key, next)} />;
  }

  if (field.type === "checkbox") {
    return (
      <input
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(field.key, e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-accent-600 focus:ring-accent-500"
      />
    );
  }

  if (field.type === "combobox") {
    return <ProviderCombobox field={field} value={value} onChange={onChange} />;
  }

  if (field.type === "select") {
    return (
      <div className="flex flex-wrap gap-2">
        {extra}
        {field.options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(field.key, opt)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              value === opt
                ? "bg-accent-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            {field.optionLabels?.[opt] || opt}
          </button>
        ))}
      </div>
    );
  }

  return (
    <input
      className={FIELD}
      type={field.secret ? "password" : "text"}
      value={value ?? ""}
      placeholder={field.secret && field.valueSet ? "••••••••  (unchanged)" : ""}
      onChange={(e) => onChange(field.key, e.target.value)}
      autoComplete={field.secret ? "new-password" : "off"}
    />
  );
}

function initialDraft(fields) {
  const draft = {};
  for (const field of fields) {
    draft[field.key] = field.secret ? "" : field.value ?? "";
  }
  return draft;
}

function groupFields(fields) {
  const order = [];
  const byGroup = new Map();
  for (const field of fields) {
    const key = field.group || "";
    if (!byGroup.has(key)) {
      byGroup.set(key, []);
      order.push(key);
    }
    byGroup.get(key).push(field);
  }
  return order.map((key) => [key, byGroup.get(key)]);
}
