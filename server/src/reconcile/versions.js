// What is actually running, for the sidebar's version block.
//
// Where a component can report its own version it is asked; where it cannot,
// or does not answer, the row falls back to what Docker knows about its image.
// Nothing here may fail the request or hold it up: every lookup is bounded by
// its own timeout and a miss only degrades that one row.

import { activeComponents } from "./catalog.js";
import { getComponentValues } from "../store/components.js";
import { connectionTarget, isManaged } from "./postgres.js";
import { inspectContainer, inspectImage } from "../docker/client.js";
import { fetchVersion } from "../instanceClient.js";
import { getVersion as getGluetunVersion } from "../gluetunClient.js";
import { serverVersion } from "./database.js";

const LOOKUP_TIMEOUT_MS = 3000;
const CACHE_TTL_MS = 60_000;
const VERSION_LABEL = "org.opencontainers.image.version";

const defaultLookups = {
  inspectContainer,
  inspectImage,
  instanceVersion: fetchVersion,
  gluetunVersion: getGluetunVersion,
  postgresVersion: serverVersion,
};

// The tag of an image reference, unless it says nothing: no tag, `latest`, or a
// digest reference. The tag separator is the last colon, and only if it comes
// after the last slash (otherwise it is a registry port).
function specificTag(imageRef) {
  const ref = String(imageRef || "");
  if (!ref || ref.includes("@")) return null;
  const lastSlash = ref.lastIndexOf("/");
  const lastColon = ref.lastIndexOf(":");
  if (lastColon <= lastSlash) return null;
  const tag = ref.slice(lastColon + 1);
  return tag && tag !== "latest" ? tag : null;
}

export function imageVersion({ labels, imageRef, imageId } = {}) {
  const label = labels?.[VERSION_LABEL];
  if (label) return { version: label, source: "image-label" };

  const tag = specificTag(imageRef);
  if (tag) return { version: tag, source: "tag" };

  const id = String(imageId || "").replace(/^sha256:/, "").slice(0, 12);
  if (id) return { version: id, source: "image-id" };

  return { version: null, source: null };
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// A lookup that fails is a miss, not an error.
async function attempt(fn) {
  try {
    return (await fn()) || null;
  } catch {
    return null;
  }
}

const NO_VERSION = { version: null, source: null };

// Running or not, plus what the image says. `unknown` means there is no
// container to look at (not run by the Suite) or Docker could not be asked.
async function containerFacts(lookups, containerName, timeoutMs) {
  if (!containerName) return { status: "unknown", fallback: NO_VERSION };

  let info;
  try {
    info = await withTimeout(lookups.inspectContainer(containerName), timeoutMs);
  } catch {
    return { status: "unknown", fallback: NO_VERSION };
  }
  if (!info) return { status: "unknown", fallback: NO_VERSION };

  const status = info.State?.Running ? "running" : "stopped";
  if (status === "stopped") return { status, fallback: NO_VERSION };

  const image = await attempt(() => withTimeout(lookups.inspectImage(info.Image), timeoutMs));
  const fallback = imageVersion({
    labels: image?.Config?.Labels,
    imageRef: info.Config?.Image,
    imageId: info.Image,
  });
  return { status, fallback };
}

async function resolveRow(base, { containerName, primary }, lookups, timeoutMs) {
  const facts = await containerFacts(lookups, containerName, timeoutMs);
  if (facts.status === "stopped") return { ...base, status: "stopped", ...NO_VERSION };

  const own = primary ? await attempt(() => withTimeout(primary(), timeoutMs)) : null;
  if (own) return { ...base, status: facts.status, version: own, source: "self" };

  return { ...base, status: facts.status, ...facts.fallback };
}

export async function collectVersions(input, lookups = defaultLookups, timeoutMs = LOOKUP_TIMEOUT_MS) {
  const { instances, components, gluetun, postgres, suiteVersion } = input;
  const rows = [];

  for (const inst of instances) {
    rows.push(
      resolveRow(
        { kind: "instance", key: inst.id, label: inst.name },
        {
          containerName: inst.containerName || null,
          primary: () => lookups.instanceVersion(inst, { timeoutMs }),
        },
        lookups,
        timeoutMs
      )
    );
  }

  for (const node of components) {
    let primary = null;
    if (node.kind === "gluetun" && gluetun) primary = () => lookups.gluetunVersion(gluetun);
    if (node.kind === "postgres" && postgres) primary = () => lookups.postgresVersion(postgres);

    rows.push(
      resolveRow(
        { kind: node.kind, key: node.key, label: node.label },
        { containerName: node.containerName || null, primary },
        lookups,
        timeoutMs
      )
    );
  }

  return { suite: { version: suiteVersion }, components: await Promise.all(rows) };
}

// Everything a collection needs, read from the store and catalog. Instances
// come from the config (Suite-managed and externally added alike); every other
// kind comes from the active stack. An external PostgreSQL has no container and
// so is not an active component, but it still has a version worth showing.
export function versionsInput(config) {
  const components = activeComponents()
    .filter((node) => node.kind !== "instance")
    .map(({ kind, key, label, containerName }) => ({ kind, key, label, containerName }));

  const pgValues = getComponentValues("postgres");
  const target = connectionTarget(pgValues);
  const postgres = target.host ? target : null;
  if (postgres && !isManaged(pgValues) && !components.some((c) => c.kind === "postgres")) {
    components.push({ kind: "postgres", key: "", label: "PostgreSQL", containerName: null });
  }

  return {
    instances: config.instances.map(({ id, name, url, apiKey, containerName }) => ({
      id,
      name,
      url,
      apiKey,
      containerName,
    })),
    components,
    gluetun: config.gluetun || null,
    postgres,
    suiteVersion: process.env.SUITE_VERSION || "dev",
  };
}

let cached = null;
let inflight = null;
let generation = 0;

// Called when something that changes what is running finishes (an apply), so
// the sidebar confirms the new versions instead of serving the last minute's.
// The generation stops a collection that started before the change from
// caching its now-stale result.
export function invalidateVersions() {
  generation += 1;
  cached = null;
  inflight = null;
}

export { invalidateVersions as _resetVersionsCache };

// One collection per minute however many tabs are polling; concurrent callers
// share the one already in flight.
export function getVersions(config, { collect = () => collectVersions(versionsInput(config)), now = Date.now } = {}) {
  if (cached && now() - cached.at < CACHE_TTL_MS) return Promise.resolve(cached.value);

  if (!inflight) {
    const started = generation;
    const run = Promise.resolve()
      .then(() => collect())
      .then((value) => {
        if (generation === started) cached = { at: now(), value };
        return value;
      })
      .finally(() => {
        if (inflight === run) inflight = null;
      });
    inflight = run;
  }
  return inflight;
}
