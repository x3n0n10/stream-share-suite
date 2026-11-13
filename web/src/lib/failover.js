// Pure logic behind FallbackPicker and the "Lent to" labels.

export function moveItem(items, index, delta) {
  const to = index + delta;
  if (index < 0 || index >= items.length || to < 0 || to >= items.length) return [...items];
  const next = [...items];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

// supported === null means the support list is still loading: offer nothing.
export function fallbackChoices(instances, selfKey, selected, supported) {
  if (!supported) return [];
  return instances.filter((i) => i.key !== selfKey && !selected.includes(i.key) && supported.includes(i.key));
}

// A viewer forwarded from another instance is named "failover:<instance name>/<stream id>".
export function lentTo(name) {
  const m = /^failover:(.+)\/[^/]*$/.exec(String(name ?? ""));
  return m ? m[1] : null;
}
