// Normalizes a component's desired configuration into our own container spec
// shape, and hashes it deterministically.
//
// The hash is computed over OUR normalized object, not Docker's create-request
// JSON or its inspect response — both of those carry fields we don't set
// (defaults the daemon fills in) or that vary in key order across API
// versions, which would make the hash flap without the desired state having
// changed. Canonicalizing here means the only thing that can change the hash
// is a real change to what we asked for.

import { createHash } from "node:crypto";

// Recursively sorts object keys so JSON.stringify is order-independent.
// Arrays are sorted too where the caller has already put them in a canonical
// order (env vars, labels-as-pairs) — this function does not itself decide
// what "canonical" means for an array, only objects.
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortKeysDeep(value[key]);
        return acc;
      }, {});
  }
  return value;
}

// A spec is our own shape, not Docker's:
//   { image, env: {KEY: value}, labels: {key: value} (component labels only —
//   managed/spec-hash are added at apply time, never hashed), capAdd: [...],
//   devices: ["/host:/container[:perms]"], networks: [...names],
//   restartPolicy, name }
//
// env and labels are objects (unordered by nature) rather than the
// "KEY=value" array Docker's API wants — that conversion happens in
// toCreatePayload, once, at the boundary. Keeping them as objects here means a
// caller can never introduce a hash difference by reordering entries.
export function computeSpecHash(spec) {
  const canonical = sortKeysDeep({
    image: spec.image,
    name: spec.name,
    env: spec.env || {},
    labels: spec.labels || {},
    capAdd: [...(spec.capAdd || [])].sort(),
    devices: [...(spec.devices || [])].sort(),
    networks: [...(spec.networks || [])].sort(),
    restartPolicy: spec.restartPolicy || "unless-stopped",
  });
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

// Converts our spec into a Docker Engine API /containers/create body. Labels
// passed in separately (rather than read from spec.labels) so the caller
// decides whether to include the managed/spec-hash pair — a plan preview wants
// the hash the spec *would* get, not one baked into the payload it renders.
export function toCreatePayload(spec, { labels } = {}) {
  const primaryNetwork = (spec.networks || [])[0];
  return {
    Image: spec.image,
    Env: Object.entries(spec.env || {}).map(([k, v]) => `${k}=${v}`),
    Labels: labels || spec.labels || {},
    HostConfig: {
      CapAdd: spec.capAdd || [],
      Devices: (spec.devices || []).map((entry) => {
        const [hostPath, containerPath, permissions] = entry.split(":");
        return {
          PathOnHost: hostPath,
          PathOnContainer: containerPath || hostPath,
          CgroupPermissions: permissions || "rwm",
        };
      }),
      RestartPolicy: { Name: spec.restartPolicy || "unless-stopped" },
      // The Engine API only accepts one network at container-create time; the
      // rest are joined with separate /networks/{name}/connect calls after
      // creation, which the reconciler issues once the container exists.
      NetworkMode: primaryNetwork || "bridge",
    },
    ...(primaryNetwork
      ? { NetworkingConfig: { EndpointsConfig: { [primaryNetwork]: {} } } }
      : {}),
  };
}
