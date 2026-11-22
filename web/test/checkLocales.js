function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out[key] = String(v);
  }
  return out;
}

const signature = (text, re) => [...text.matchAll(re)].map((m) => m[1]).sort().join();
const placeholders = (s) => signature(s, /\{\{\s*([^}\s]+?)\s*(?:,[^}]*)?\}\}/g);
const tags = (s) => signature(s, /<\/?([A-Za-z0-9]+)\s*\/?>/g);

// French and Spanish need _many (and others _few, _two, _zero) where English
// has only _one and _other, so those suffixes count as in en when en has the
// base key as a plural.
const PLURAL_EXTRA = /_(zero|two|few|many)$/;
const inEn = (a, key) => {
  const base = key.replace(PLURAL_EXTRA, "");
  return key in a || (base !== key && (`${base}_one` in a || `${base}_other` in a));
};

// Returns a list of problems in `other` compared with the English source.
// Test-only tooling, kept out of the runtime bundle.
export function checkLocales(en, other, { requireAll = false } = {}) {
  const a = flatten(en);
  const b = flatten(other);
  const problems = [];
  for (const [key, text] of Object.entries(b)) {
    if (!inEn(a, key)) {
      problems.push(`${key}: not in en`);
      continue;
    }
    if (!(key in a)) continue; // extra plural form: nothing in en to compare with
    if (placeholders(a[key]) !== placeholders(text)) problems.push(`${key}: placeholders differ from en`);
    if (tags(a[key]) !== tags(text)) problems.push(`${key}: tags differ from en`);
  }
  if (requireAll) for (const key of Object.keys(a)) if (!(key in b)) problems.push(`${key}: missing`);
  return problems;
}
