// "DNS challenge" -> "dnsChallenge": the translation key for a schema group.
// No imports: server/test/i18n-coverage.test.js loads this file directly.
export function groupSlug(name) {
  return String(name)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w))
    .join("");
}

// The translation key layout lives here only. Each helper takes `t` and falls
// back to the server's English.
export const fieldText = (t, kind, key, part, fallback) =>
  t(`schema.${kind}.fields.${key}.${part}`, { defaultValue: fallback });

export const groupText = (t, kind, group) =>
  t(`schema.${kind}.groups.${groupSlug(group)}`, { defaultValue: group });

// A user-named instance is never translated.
export const catalogText = (t, component, part) =>
  component.kind === "instance"
    ? component[part]
    : t(`catalog.${component.kind}.${part}`, { defaultValue: component[part] });
