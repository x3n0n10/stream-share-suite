// Mirrors the key-slugging half of server/src/reconcile/provisioning.js's
// instanceKeyFor — close enough to preview a container's default name as
// someone types, not a second source of truth. The server always has the
// final say: it also checks the externally-configured instances table this
// preview has no access to, so an actual clash still gets a "-2" suffix
// there even when this preview didn't predict one.
export function previewInstanceKey(displayName, existingKeys = []) {
  const base =
    String(displayName || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "instance";

  const taken = new Set(existingKeys);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}

// What renderInstanceSpec will actually name the container: the containerName
// override if one is typed, otherwise the prefix plus the key it would get.
export function previewContainerName({ displayName, containerName }, { prefix, existingKeys = [] }) {
  const override = String(containerName || "").trim();
  if (override) return override;
  return `${prefix}${previewInstanceKey(displayName, existingKeys)}`;
}
