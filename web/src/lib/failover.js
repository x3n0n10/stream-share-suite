// Pure failover logic: FallbackPicker helpers and the fallback note on Overview and History.

export function moveItem(items, index, delta) {
  const to = index + delta;
  if (index < 0 || index >= items.length || to < 0 || to >= items.length) return [...items];
  const next = [...items];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

// Why an instance cannot be a fallback right now, or null when it can.
// support is the /failover-support answer; null while it is still loading.
export function unsupportedReason(key, support) {
  if (!support || support.supported.includes(key)) return null;
  return support.unreachable.includes(key) ? "not running yet" : "needs a newer StreamShare version";
}

// Whether to keep rechecking support: while it loads, or while some other
// instance cannot be picked. Also covers "needs a newer version", because an
// image upgrade applied from this same page fires no focus event.
export function needsRecheck(instances, selfKey, support) {
  return instances.some((i) => i.key !== selfKey && (!support || unsupportedReason(i.key, support) !== null));
}

// Every other instance not yet picked, each with the reason it cannot be
// picked (null when it can), so none silently goes missing. Nothing while
// support is loading.
export function fallbackChoices(instances, selfKey, selected, support) {
  if (!support) return [];
  return instances
    .filter((i) => i.key !== selfKey && !selected.includes(i.key))
    .map((i) => ({ ...i, reason: unsupportedReason(i.key, support) }));
}

// The amber line under a stream served through a fallback instance. live is
// true on Overview (now playing), false on History (past tense).
export function failoverNote({ via, via_channel }, live) {
  if (via_channel) return live ? `Showing ${via}'s ${via_channel} instead` : `Used ${via}'s ${via_channel}`;
  return live ? `Using ${via}'s connection` : `Used ${via}'s connection`;
}
