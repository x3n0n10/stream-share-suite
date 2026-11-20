// Connections in use on a provider subscription: the higher of the provider's
// own total (cached, so it can lag) and this instance's live count.
export function connectionUsage(provider) {
  const local = provider.local_upstream_connections;
  const here = typeof local === "number" ? Math.max(0, local) : null;
  const used = Math.max(0, provider.active_connections ?? 0, here ?? 0);
  return { used, here, max: provider.max_connections };
}
