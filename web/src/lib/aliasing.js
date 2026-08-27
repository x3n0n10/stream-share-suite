// A viewer is only ever aliased when LDAP is disabled and the raw client IP
// stands in as their identity (see displayNameFor in stream-share), so only
// offer the "add alias" shortcut for identifiers that actually look like an
// IP address, and only when it doesn't already have one.
const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F]*:[0-9a-fA-F:]*$/;

export function isAliasableId(id, label) {
  if (!id || !IP_RE.test(id)) return false;
  return !label || label === id;
}
