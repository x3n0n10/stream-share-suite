// The prefix every Suite-created container's default name starts with.
//
// Fixed by environment variable, the same as SUITE_DATA_DIR and
// SUITE_CACHE_DIR: a once-per-install choice the operator makes in compose,
// not something to retype in the Suite UI. The default guarantees a fresh
// install never collides with anything already on the host; the override
// exists for the one case a default can't cover on its own — more than one
// Suite installed on the same host, each needing containers that don't
// collide with the other's.
//
// This only ever decides a *default* name. Every component that uses it also
// carries its own containerName override field, so a container the operator
// already runs under a different name can still be pinned and adopted.
const DEFAULT_PREFIX = "streamshare-suite-";

export function containerPrefix() {
  const value = String(process.env.SUITE_CONTAINER_PREFIX ?? "").trim();
  return value || DEFAULT_PREFIX;
}
