import { useMemo, useState } from "react";
import { Button, ErrorNote } from "./common.jsx";

const FIELD =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
  "placeholder:text-slate-400 focus:border-accent-500 focus:outline-none focus:ring-1 " +
  "focus:ring-accent-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white";

// Renders a form from field metadata rather than hand-coded JSX — this is
// the point of the schema registry: a new field on the server is a new row
// in the rendered form with no frontend change at all. Everything here is
// generic over shape; a component's meaning lives entirely in its schema.
export default function SchemaForm({ fields, onSave, saving, error, submitLabel = "Save" }) {
  const [draft, setDraft] = useState(() => initialDraft(fields));
  const [showAdvanced, setShowAdvanced] = useState(false);

  const groups = useMemo(() => groupFields(fields), [fields]);

  function isVisible(field) {
    if (!field.dependsOn) return true;
    const conditions = Array.isArray(field.dependsOn) ? field.dependsOn : [field.dependsOn];
    return conditions.every((condition) => {
      const depValue = draft[condition.key];
      return "oneOf" in condition ? condition.oneOf.includes(depValue) : depValue === condition.equals;
    });
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
                <FieldInput key={field.key} field={field} value={draft[field.key]} onChange={set} />
              ))}
            </div>
            {advanced.length > 0 && (
              <details className="group" open={showAdvanced} onToggle={(e) => setShowAdvanced(e.target.open)}>
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

      {error && <ErrorNote message={error} />}

      <div>
        <Button type="submit" tone="accent" loading={saving} disabled={saving}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function FieldInput({ field, value, onChange }) {
  const hint = field.secret
    ? field.valueSet
      ? "Set. Leave blank to keep it."
      : "Not set."
    : field.help;

  return (
    <label className={`flex flex-col gap-1.5 ${field.type === "textarea" ? "sm:col-span-2" : ""}`}>
      <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
        {field.label}
        {field.required && <span className="text-rose-500"> *</span>}
      </span>
      {renderControl(field, value, onChange)}
      {hint && <span className="text-[11px] text-slate-400 dark:text-slate-500">{hint}</span>}
    </label>
  );
}

function renderControl(field, value, onChange) {
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

  if (field.type === "select") {
    return (
      <select className={FIELD} value={value ?? ""} onChange={(e) => onChange(field.key, e.target.value)}>
        {field.options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
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
