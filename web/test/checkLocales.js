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

// Returns a list of problems in `other` compared with the English source.
// Test-only tooling, kept out of the runtime bundle.
export function checkLocales(en, other, { requireAll = false } = {}) {
  const a = flatten(en);
  const b = flatten(other);
  const problems = [];
  for (const [key, text] of Object.entries(b)) {
    if (!(key in a)) {
      problems.push(`${key}: not in en`);
      continue;
    }
    if (placeholders(a[key]) !== placeholders(text)) problems.push(`${key}: placeholders differ from en`);
    if (tags(a[key]) !== tags(text)) problems.push(`${key}: tags differ from en`);
  }
  if (requireAll) for (const key of Object.keys(a)) if (!(key in b)) problems.push(`${key}: missing`);
  return problems;
}
