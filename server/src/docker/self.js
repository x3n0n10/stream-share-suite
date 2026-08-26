// Figures out which Docker networks the Suite's own container is on, and
// their subnets — used to auto-populate gluetun's FIREWALL_OUTBOUND_SUBNETS
// (see the blueprint's invariants table) rather than asking the operator to
// type a CIDR that has to match a network they didn't necessarily name.
//
// The technique: Docker sets a container's hostname to its own short ID
// unless the compose file overrides it, and the Engine API's inspect
// endpoint accepts an ID prefix. Neither of those is guaranteed — a
// hand-set `hostname:` in compose would break it — so every failure mode
// here returns an empty list rather than throwing, and the caller (the
// gluetun renderer) treats an empty list as "couldn't determine it" and
// simply leaves the field unset.

import { hostname } from "node:os";
import { inspectContainer } from "./client.js";

// Network address for ipAddress/prefixLen, e.g. ("172.18.0.5", 24) ->
// "172.18.0.0/24". IPv4 only — the subnets this feeds into are IPv4 in every
// deployment this targets.
export function ipv4NetworkCidr(ipAddress, prefixLen) {
  if (!ipAddress || prefixLen === undefined || prefixLen === null) return null;
  const octets = ipAddress.split(".").map(Number);
  if (octets.length !== 4 || octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return null;
  if (prefixLen < 0 || prefixLen > 32) return null;

  const ipInt = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  const mask = prefixLen === 0 ? 0 : (0xffffffff << (32 - prefixLen)) >>> 0;
  const netInt = (ipInt & mask) >>> 0;
  const netOctets = [24, 16, 8, 0].map((shift) => (netInt >>> shift) & 0xff);
  return `${netOctets.join(".")}/${prefixLen}`;
}

export async function getSelfNetworks() {
  let info;
  try {
    info = await inspectContainer(hostname());
  } catch {
    return [];
  }
  if (!info) return [];

  const networks = info.NetworkSettings?.Networks || {};
  const result = [];
  for (const [name, settings] of Object.entries(networks)) {
    const subnet = ipv4NetworkCidr(settings.IPAddress, settings.IPPrefixLen);
    if (subnet) result.push({ name, subnet });
  }
  return result;
}
