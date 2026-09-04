// Thin client for the Docker Engine API, spoken over HTTP to a socket proxy
// (tecnativa/docker-socket-proxy) rather than to /var/run/docker.sock
// directly. The Suite process never sees the real socket — see the
// blueprint's threat-model section for why that boundary is non-negotiable
// once the same origin can create privileged containers.
//
// Endpoint shapes below are taken from the Docker Engine API v1.43 OpenAPI
// spec, verified against the published spec rather than assumed:
// https://docs.docker.com/reference/api/engine/version/v1.43.yaml

const API_VERSION = "v1.43";

class DockerError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "DockerError";
    this.status = status;
  }
}

function baseUrl() {
  return (process.env.DOCKER_PROXY_URL || "http://docker-socket-proxy:2375").replace(/\/+$/, "");
}

async function request(method, path, { query, body, timeoutMs = 15000 } = {}) {
  const url = new URL(`${baseUrl()}/${API_VERSION}${path}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new DockerError(`Docker API request timed out after ${timeoutMs}ms: ${method} ${path}`, 504);
    }
    throw new DockerError(`Cannot reach the Docker socket proxy: ${err.message}`, 502);
  } finally {
    clearTimeout(timer);
  }

  return res;
}

async function parseJsonOrThrow(res, context) {
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new DockerError(`${context}: non-JSON response (HTTP ${res.status})`, res.status);
  }
  if (!res.ok) {
    throw new DockerError(`${context}: ${body.message || `HTTP ${res.status}`}`, res.status);
  }
  return body;
}

// filters is our own {label: ["k=v", ...], name: ["x"]} shape, converted to
// the map[string][]string the API's `filters` query param expects, JSON
// encoded — this is the one part of the API that is easy to get subtly wrong,
// since it looks like it wants an object but actually wants string arrays.
export async function listContainers({ all = true, filters } = {}) {
  const query = { all };
  if (filters) query.filters = JSON.stringify(filters);
  const res = await request("GET", "/containers/json", { query });
  return parseJsonOrThrow(res, "listContainers");
}

export async function inspectContainer(idOrName) {
  const res = await request("GET", `/containers/${encodeURIComponent(idOrName)}/json`);
  if (res.status === 404) return null;
  return parseJsonOrThrow(res, `inspectContainer(${idOrName})`);
}

// Docker takes the container name as a query parameter, not a body field.
export async function createContainer(name, payload) {
  const res = await request("POST", "/containers/create", { query: { name }, body: payload });
  return parseJsonOrThrow(res, `createContainer(${name})`);
}

// 204 = started, 304 = already running — both are success from the caller's
// point of view; only a 404/500 is a real failure.
export async function startContainer(idOrName) {
  const res = await request("POST", `/containers/${encodeURIComponent(idOrName)}/start`);
  if (res.status === 204 || res.status === 304) return;
  await parseJsonOrThrow(res, `startContainer(${idOrName})`);
}

export async function stopContainer(idOrName, { timeoutSeconds = 15 } = {}) {
  const res = await request("POST", `/containers/${encodeURIComponent(idOrName)}/stop`, {
    query: { t: timeoutSeconds },
    timeoutMs: (timeoutSeconds + 10) * 1000,
  });
  if (res.status === 204 || res.status === 304) return;
  await parseJsonOrThrow(res, `stopContainer(${idOrName})`);
}

// 404 is treated as success: removing something already gone is the outcome
// the caller wanted, not a failure to report.
export async function removeContainer(idOrName, { force = false } = {}) {
  const res = await request("DELETE", `/containers/${encodeURIComponent(idOrName)}`, {
    query: { force, v: true },
  });
  if (res.status === 204 || res.status === 404) return;
  await parseJsonOrThrow(res, `removeContainer(${idOrName})`);
}

export async function connectNetwork(networkName, containerId) {
  const res = await request("POST", `/networks/${encodeURIComponent(networkName)}/connect`, {
    body: { Container: containerId },
  });
  if (res.status === 200) return;
  await parseJsonOrThrow(res, `connectNetwork(${networkName}, ${containerId})`);
}

export async function inspectImage(idOrName) {
  const res = await request("GET", `/images/${encodeURIComponent(idOrName)}/json`);
  if (res.status === 404) return null;
  return parseJsonOrThrow(res, `inspectImage(${idOrName})`);
}

// Splits "repo:tag" the way the /images/create endpoint wants it — as two
// separate query params, not one string — without mistaking a registry
// host's port for a tag separator (myregistry:5000/repo has a colon that
// isn't one). The tag-separating colon, if any, is always the last one and
// always comes after the last slash.
function splitImageTag(image) {
  const lastSlash = image.lastIndexOf("/");
  const lastColon = image.lastIndexOf(":");
  if (lastColon > lastSlash) {
    return [image.slice(0, lastColon), image.slice(lastColon + 1)];
  }
  return [image, "latest"];
}

// Docker streams NDJSON progress lines instead of one JSON body, and reports
// a failed pull as an {error: "..."} line rather than an HTTP error status —
// callers who only checked res.ok would see a pull that silently did
// nothing. A pull can take a while, hence the much longer default timeout
// than every other call in this file.
export async function pullImage(image, { timeoutMs = 300000 } = {}) {
  const [fromImage, tag] = splitImageTag(image);
  const res = await request("POST", "/images/create", { query: { fromImage, tag }, timeoutMs });
  const text = await res.text();

  if (!res.ok) {
    throw new DockerError(`pullImage(${image}): HTTP ${res.status}`, res.status);
  }

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.error) {
      throw new DockerError(`pullImage(${image}): ${entry.error}`, 502);
    }
  }
}

export async function ping() {
  const res = await request("GET", "/_ping", { timeoutMs: 5000 });
  return res.status === 200;
}

export { DockerError };
