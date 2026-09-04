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

// The only elevated Docker privileges anything in this app has ever needed
// (gluetun's tunnel) — see reconcile/gluetun.js. Not a schema field, not
// operator-editable, so this is not "let the operator pick a wider set" but
// an assertion that nothing else can silently reach HostConfig with more:
// the same "deny by default" the socket-proxy's own allowlist already
// enforces one layer out, held here too, where the actual privilege
// translation happens.
const ALLOWED_CAPABILITIES = new Set(["NET_ADMIN"]);
const ALLOWED_DEVICE_HOST_PATHS = new Set(["/dev/net/tun"]);

function assertSafeHostConfig(spec) {
  for (const cap of spec.capAdd || []) {
    if (!ALLOWED_CAPABILITIES.has(cap)) {
      throw new Error(`Refusing to grant an unrecognised Docker capability: ${cap}`);
    }
  }
  for (const entry of spec.devices || []) {
    const hostPath = entry.split(":")[0];
    if (!ALLOWED_DEVICE_HOST_PATHS.has(hostPath)) {
      throw new Error(`Refusing to grant access to an unrecognised device: ${hostPath}`);
    }
  }
  if (spec.privileged) {
    throw new Error("Refusing to create a privileged container");
  }
}

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
//   devices: ["/host:/container[:perms]"], volumes: ["/host:/container[:ro]"],
//   ports: [{host, container, protocol}], networks: [...names],
//   networkMode, restartPolicy, name }
//
// env and labels are objects (unordered by nature) rather than the
// "KEY=value" array Docker's API wants — that conversion happens in
// toCreatePayload, once, at the boundary. Keeping them as objects here means a
// caller can never introduce a hash difference by reordering entries.
//
// `networkMode` is for a container that joins another's network namespace
// ("container:stream-share-gluetun"). It is mutually exclusive with
// `networks`: Docker will not attach such a container to a network, and will
// not let it publish ports either — which is why an instance behind the VPN
// has its ports published by gluetun instead of by itself.
export function computeSpecHash(spec) {
  assertSafeHostConfig(spec);

  // Fields are omitted when empty rather than canonicalised to [] or null, so
  // that adding a field to this function does not change the hash of a spec
  // that does not use it. Without that, every existing managed container would
  // read as "configuration changed" the first time the Suite is upgraded —
  // a stack-wide recreate to change precisely nothing.
  const canonical = {
    image: spec.image,
    name: spec.name,
    env: spec.env || {},
    labels: spec.labels || {},
    capAdd: [...(spec.capAdd || [])].sort(),
    devices: [...(spec.devices || [])].sort(),
    networks: [...(spec.networks || [])].sort(),
    restartPolicy: spec.restartPolicy || "unless-stopped",
  };

  if ((spec.volumes || []).length > 0) canonical.volumes = [...spec.volumes].sort();
  if ((spec.ports || []).length > 0) canonical.ports = normalisePorts(spec.ports);
  if (spec.networkMode) canonical.networkMode = spec.networkMode;
  if (spec.user) canonical.user = spec.user;

  return createHash("sha256").update(JSON.stringify(sortKeysDeep(canonical))).digest("hex");
}

// Ports are sorted into one canonical order and given their default protocol,
// so that reordering the list — or writing "8080" where another caller wrote
// 8080 — cannot make an unchanged container look changed.
function normalisePorts(ports) {
  return ports
    .map((port) => ({
      host: Number(port.host),
      container: Number(port.container),
      protocol: port.protocol || "tcp",
    }))
    .sort((a, b) => a.host - b.host || a.container - b.container || a.protocol.localeCompare(b.protocol));
}

// Converts our spec into a Docker Engine API /containers/create body. Labels
// passed in separately (rather than read from spec.labels) so the caller
// decides whether to include the managed/spec-hash pair — a plan preview wants
// the hash the spec *would* get, not one baked into the payload it renders.
export function toCreatePayload(spec, { labels } = {}) {
  assertSafeHostConfig(spec);

  // A container sharing another's network namespace is not attached to any
  // network of its own, so networkMode wins outright when set.
  const primaryNetwork = spec.networkMode ? null : (spec.networks || [])[0];
  const ports = normalisePorts(spec.ports || []);

  const payload = {
    Image: spec.image,
    Env: Object.entries(spec.env || {}).map(([k, v]) => `${k}=${v}`),
    Labels: labels || spec.labels || {},
    // "uid:gid". Set so a container writes its bind-mounted data as the same
    // ids the Suite created those directories with — stream-share's image runs
    // as a non-root user and never chowns, so the two have to agree or it
    // cannot write its own config.
    ...(spec.user ? { User: spec.user } : {}),
    HostConfig: {
      CapAdd: spec.capAdd || [],
      Binds: spec.volumes || [],
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
      NetworkMode: spec.networkMode || primaryNetwork || "bridge",
    },
  };

  if (ports.length > 0) {
    // ExposedPorts sits on the container config; PortBindings sits on
    // HostConfig. Docker wants both, and publishing silently does nothing if
    // only one is set.
    payload.ExposedPorts = {};
    payload.HostConfig.PortBindings = {};
    for (const port of ports) {
      const key = `${port.container}/${port.protocol}`;
      payload.ExposedPorts[key] = {};
      payload.HostConfig.PortBindings[key] = [{ HostIp: "0.0.0.0", HostPort: String(port.host) }];
    }
  }

  if (primaryNetwork) {
    payload.NetworkingConfig = { EndpointsConfig: { [primaryNetwork]: {} } };
  }

  return payload;
}
