// Pure logic behind ListInput: a list field is stored as one comma-separated
// string, so everything here converts between that string and an array.

const VALID = {
  text: (s) => s.length > 0,
  number: (s) => /^\d+$/.test(s),
  time: (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s),
};

export function parseItems(value) {
  const seen = new Set();
  for (const part of String(value ?? "").split(",")) {
    const item = part.trim();
    if (item) seen.add(item);
  }
  return [...seen];
}

export function normalizeItem(raw, itemType = "text") {
  const item = String(raw ?? "").trim();
  return (VALID[itemType] || VALID.text)(item) ? item : null;
}

export function addItems(items, raw, { itemType = "text", sort = false } = {}) {
  const next = [...items];
  for (const part of String(raw ?? "").split(",")) {
    const item = normalizeItem(part, itemType);
    if (item && !next.includes(item)) next.push(item);
  }
  return sort ? next.sort() : next;
}

export function removeItem(items, item) {
  return items.filter((i) => i !== item);
}

export function joinItems(items) {
  return items.join(",");
}
