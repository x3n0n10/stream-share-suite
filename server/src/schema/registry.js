// Generic engine over a component's field schema: validate values against it,
// render them to the environment variables a container spec needs, and
// project them for the HTTP API and a generic frontend form.
//
// The point of a schema is that a new field is a data change, not a new form
// to hand-write. A field descriptor looks like:
//
//   {
//     key: "vpnServiceProvider",   // storage key and the object key everywhere below
//     envVar: "VPN_SERVICE_PROVIDER", // null for fields that don't become env vars
//     label: "VPN provider",
//     help: "...",                 // optional
//     group: "VPN",                // for grouping the rendered form
//     type: "text" | "select" | "checkbox",
//     options: [...],              // required for "select"
//     secret: true,                // write-only: see applyPatch and toPublicFields
//     advanced: false,             // collapsed behind an "Advanced" toggle
//     required: true,
//     default: "wireguard",
//     dependsOn: { key: "vpnType", equals: "wireguard" }, // optional
//   }
//
// dependsOn also accepts { key, oneOf: [...] } for "any of these values", and
// an array of conditions ANDed together — e.g. a field only relevant for one
// provider's WireGuard setup: [{ key: "vpnType", equals: "wireguard" },
// { key: "vpnServiceProvider", oneOf: ["mullvad"] }].

function resolvedValue(field, values) {
  const raw = values[field.key];
  if (raw === undefined || raw === null || raw === "") {
    return field.default !== undefined ? field.default : raw;
  }
  return raw;
}

// Checked against the referenced field's *resolved* value (default applied),
// not the raw stored one — otherwise a field whose visibility depends on
// another field's default would incorrectly read as hidden until that other
// field had actually been saved once.
function conditionMet(condition, depValue) {
  if ("oneOf" in condition) return condition.oneOf.includes(depValue);
  return depValue === condition.equals;
}

function isVisible(field, values, schema) {
  if (!field.dependsOn) return true;
  const conditions = Array.isArray(field.dependsOn) ? field.dependsOn : [field.dependsOn];
  return conditions.every((condition) => {
    const depField = schema.fields.find((f) => f.key === condition.key);
    const depValue = depField ? resolvedValue(depField, values) : values[condition.key];
    return conditionMet(condition, depValue);
  });
}

// Whether a field's `required` applies right now.
//
// Distinct from dependsOn, which decides whether a field is shown at all. A
// field can be relevant in every mode and yet only mandatory in one: a
// PostgreSQL administrator password is required for a server the Suite runs
// (the image will not start without one) but genuinely optional for an
// external server using trust or peer authentication.
function isRequired(field, values, schema) {
  if (!field.required) return false;
  if (!field.requiredWhen) return true;

  const conditions = Array.isArray(field.requiredWhen) ? field.requiredWhen : [field.requiredWhen];
  return conditions.every((condition) => {
    const depField = schema.fields.find((f) => f.key === condition.key);
    const depValue = depField ? resolvedValue(depField, values) : values[condition.key];
    return conditionMet(condition, depValue);
  });
}

// Required fields are only enforced when visible (dependsOn satisfied) — a
// WireGuard-only field is not "missing" on an OpenVPN configuration.
export function validate(schema, values) {
  const errors = [];
  for (const field of schema.fields) {
    if (!isVisible(field, values, schema)) continue;

    const value = resolvedValue(field, values);
    const missing = value === undefined || value === null || value === "";

    if (missing) {
      if (isRequired(field, values, schema)) {
        errors.push({ key: field.key, message: `${field.label} is required.` });
      }
      continue;
    }

    // Checked for every visible select that has a value, not only required
    // ones — an optional field holding a value outside its own options is
    // wrong whether or not it had to be filled in.
    if (field.type === "select" && !field.options.includes(value)) {
      errors.push({ key: field.key, message: `${field.label} must be one of: ${field.options.join(", ")}.` });
    }
  }
  return errors;
}

// Renders visible fields with an envVar to a flat {ENV_VAR: value} object,
// coercing booleans to the "true"/"false" strings env vars expect. A field
// hidden by dependsOn is omitted entirely rather than sent empty — an unset
// var and an empty one are not always the same thing to what reads it.
export function renderEnv(schema, values) {
  const env = {};
  for (const field of schema.fields) {
    if (!field.envVar) continue;
    if (!isVisible(field, values, schema)) continue;
    const value = resolvedValue(field, values);
    if (value === undefined || value === null || value === "") continue;
    env[field.envVar] = typeof value === "boolean" ? String(value) : value;
  }
  return env;
}

// What the HTTP API and the generic frontend form see: every field's
// metadata, plus its current value — except a secret field, which reports
// only whether one is set. This is the same write-only convention already
// used for instance API keys and the gluetun ops credentials; the schema
// registry just makes it apply uniformly to every field of every component.
export function toPublicFields(schema, values) {
  return schema.fields.map((field) => {
    const base = {
      key: field.key,
      label: field.label,
      help: field.help || null,
      group: field.group || null,
      type: field.type || "text",
      options: field.options || null,
      secret: !!field.secret,
      advanced: !!field.advanced,
      required: !!field.required,
      dependsOn: field.dependsOn || null,
    };
    if (field.secret) {
      return { ...base, valueSet: !!values[field.key] };
    }
    return { ...base, value: resolvedValue(field, values) };
  });
}

// Merges a patch into stored values under the write-only convention:
//   - a secret field: undefined leaves the stored value alone, null clears
//     it, a non-empty string replaces it.
//   - any other field: undefined leaves it alone, anything else (including
//     "") replaces it — there is nothing to protect, so there is no reason
//     to distinguish "clear" from "set to empty".
// Keys not present in the schema are dropped rather than stored, so a typo
// in a request body silently vanishes instead of accumulating as junk that
// renderEnv will never read.
export function applyPatch(schema, existingValues, patch) {
  const next = { ...existingValues };
  for (const field of schema.fields) {
    if (!(field.key in patch)) continue;
    const incoming = patch[field.key];

    if (field.secret) {
      if (incoming === undefined) continue;
      if (incoming === null || incoming === "") delete next[field.key];
      else next[field.key] = String(incoming);
      continue;
    }

    if (incoming === undefined) continue;
    next[field.key] = field.type === "checkbox" ? !!incoming : incoming;
  }
  return next;
}
