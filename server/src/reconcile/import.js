// Finding and reading configuration for something already running on the
// Docker host, so migrating an existing stack means confirming what the
// Suite found rather than retyping every field by hand.
//
// Import is not the same thing as Adopt (see reconciler.js). Adopting a
// container only ever means "leave it running, untouched" — it never fills
// in the Suite's own stored configuration for that component, so an adopted
// container's own form stays blank until someone types into it by hand.
// Import is what actually reads a real container's own Docker inspect data
// and turns it into that stored configuration, using each schema's own
// envVar mapping in reverse (see schema/registry.js's valuesFromEnv). Like
// Adopt, it never touches the container itself — only what the Suite has
// stored about it.

import { listContainers, inspectContainer } from "../docker/client.js";
import { isManaged } from "../docker/labels.js";
import { GLUETUN_SCHEMA } from "../schema/gluetun.js";
import { POSTGRES_SCHEMA } from "../schema/postgres.js";
import { INSTANCE_SCHEMA } from "../schema/instance.js";
import { valuesFromEnv } from "../schema/registry.js";
import { saveComponentValues, setAdoptedContainer, getComponentRow, listComponents } from "../store/components.js";
import { gluetunContainerName } from "./gluetun.js";
import { postgresContainerName } from "./postgres.js";
import { instanceContainerName, allocatedPorts } from "./instance.js";
import { instanceKeyFor } from "./provisioning.js";

// Env vars every renderer computes and sets itself rather than asking for —
// importing one back in as extraEnv would just be feeding a value straight
// back to the same place that already sets it on every apply.
const GLUETUN_COMPUTED_VARS = new Set(["HTTP_CONTROL_SERVER_ADDRESS", "FIREWALL_OUTBOUND_SUBNETS"]);
const INSTANCE_COMPUTED_VARS = new Set([
  "PORT",
  "INSTANCE_NAME",
  "CACHE_FOLDER",
  "LDAP_ENABLED",
  "INTERNAL_API_KEY",
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
]);

function parseEnvArray(envArray) {
  const env = {};
  for (const line of envArray || []) {
    const i = line.indexOf("=");
    if (i === -1) continue;
    env[line.slice(0, i)] = line.slice(i + 1);
  }
  return env;
}

function networksOf(inspect) {
  return Object.keys(inspect.NetworkSettings?.Networks || {});
}

function nameOf(inspect) {
  return (inspect.Name || "").replace(/^\//, "");
}

// Classifies a running container as an import candidate purely by its image
// — a container's name is whatever its own compose file happened to call
// it, but the image is the one thing that reliably says what something is.
function classify(image) {
  if (/gluetun/i.test(image)) return "gluetun";
  if (/postgres/i.test(image)) return "postgres";
  // Anchored so this project's own images — stream-share-suite,
  // stream-share-dashboard — never misclassify as an instance.
  if (/(^|\/)stream-share(:|@|$)/i.test(image)) return "instance";
  return null;
}

export async function listImportCandidates() {
  const containers = await listContainers({ all: true });
  const candidates = [];

  for (const container of containers) {
    if (isManaged(container.Labels || {})) continue; // already ours
    const kind = classify(container.Image || "");
    if (!kind) continue;

    candidates.push({
      containerId: container.Id,
      name: (container.Names || [])[0]?.replace(/^\//, "") || container.Id,
      image: container.Image,
      kind,
    });
  }

  return candidates;
}

// Leftover env — everything the schema didn't model and the renderer doesn't
// compute itself — folded into the same extraEnv escape hatch a hand-typed
// unmodelled setting already goes through, so importing never silently drops
// something the running container actually depends on.
function foldExtraEnv(env, consumed, computedVars) {
  const lines = Object.entries(env)
    .filter(([key]) => !consumed.has(key) && !computedVars.has(key))
    .map(([key, value]) => `${key}=${value}`);
  return lines.join("\n");
}

function isConfigured(kind, key = "") {
  const row = getComponentRow(kind, key);
  return !!row && Object.keys(JSON.parse(row.config_json || "{}")).length > 0;
}

async function importGluetun(inspect, { overwrite }) {
  if (isConfigured("gluetun") && !overwrite) {
    throw new Error("gluetun is already configured. Import again with overwrite to replace it.");
  }

  const env = parseEnvArray(inspect.Config?.Env);
  const { values, consumed } = valuesFromEnv(GLUETUN_SCHEMA, env);

  const name = nameOf(inspect);
  if (name && name !== gluetunContainerName({})) values.containerName = name;
  values.image = inspect.Config?.Image || values.image;

  const networks = networksOf(inspect);
  if (networks.length > 0) values.networks = networks.join(",");

  const extraEnv = foldExtraEnv(env, consumed, GLUETUN_COMPUTED_VARS);
  if (extraEnv) values.extraEnv = extraEnv;

  saveComponentValues("gluetun", values);
  setAdoptedContainer("gluetun", inspect.Id);
  return { kind: "gluetun", key: "" };
}

async function importPostgres(inspect, { overwrite }) {
  if (isConfigured("postgres") && !overwrite) {
    throw new Error("PostgreSQL is already configured. Import again with overwrite to replace it.");
  }

  const env = parseEnvArray(inspect.Config?.Env);
  const { values } = valuesFromEnv(POSTGRES_SCHEMA, env);
  values.mode = "managed";

  // adminUser/adminPassword are envVar: null in the schema (they also serve
  // an external server, which renders no env at all), so renderPostgresSpec
  // sets POSTGRES_USER/POSTGRES_PASSWORD directly rather than through the
  // generic mechanism — valuesFromEnv has no envVar to recover them by,
  // unlike every other field here.
  if (env.POSTGRES_USER) values.adminUser = env.POSTGRES_USER;
  if (env.POSTGRES_PASSWORD) values.adminPassword = env.POSTGRES_PASSWORD;

  const name = nameOf(inspect);
  if (name && name !== postgresContainerName({})) values.containerName = name;
  values.image = inspect.Config?.Image || values.image;

  const networks = networksOf(inspect);
  if (networks.length > 0) values.networks = networks.join(",");

  saveComponentValues("postgres", values);
  setAdoptedContainer("postgres", inspect.Id);
  return { kind: "postgres", key: "" };
}

async function importInstance(inspect) {
  // A container already imported keeps its adopted_container_id, so
  // re-running import against the same one would otherwise create a second
  // instance row pointed at it instead of refreshing the first.
  const already = listComponents("instance").find((row) => row.adopted_container_id === inspect.Id);
  if (already) {
    throw new Error(`This container is already imported as the instance "${already.key}".`);
  }

  const env = parseEnvArray(inspect.Config?.Env);
  const { values, consumed } = valuesFromEnv(INSTANCE_SCHEMA, env);

  const name = nameOf(inspect);
  values.displayName = env.INSTANCE_NAME || values.displayName || name || "Imported instance";
  values.authMode = env.LDAP_ENABLED === "true" ? "ldap" : "basic";
  values.image = inspect.Config?.Image || values.image;

  const key = instanceKeyFor(values.displayName);
  if (name && name !== instanceContainerName(key, {})) values.containerName = name;

  const port = Number(env.PORT);
  if (Number.isFinite(port) && port > 0) {
    const clashingKey = allocatedPorts().get(port);
    if (clashingKey) {
      throw new Error(`Port ${port} is already used by ${clashingKey} — resolve that first.`);
    }
    values.port = String(port);
  }

  // The real database and role already exist under these exact credentials —
  // recovered from the container's own env, never regenerated, or the
  // instance would be left pointing at a role whose password just changed
  // under it.
  if (env.INTERNAL_API_KEY) values._apiKey = env.INTERNAL_API_KEY;
  if (env.DB_NAME) values._dbName = env.DB_NAME;
  if (env.DB_USER) values._dbUser = env.DB_USER;
  if (env.DB_PASSWORD) values._dbPassword = env.DB_PASSWORD;

  const extraEnv = foldExtraEnv(env, consumed, INSTANCE_COMPUTED_VARS);
  if (extraEnv) values.extraEnv = extraEnv;

  saveComponentValues("instance", values, key);
  setAdoptedContainer("instance", inspect.Id, key);
  return { kind: "instance", key };
}

export async function importCandidate(containerId, kind, { overwrite = false } = {}) {
  const inspect = await inspectContainer(containerId);
  if (!inspect) throw new Error(`No container found for ${containerId}.`);
  if (isManaged(inspect.Config?.Labels || {})) {
    throw new Error("This container is already managed by the Suite.");
  }

  if (kind === "gluetun") return importGluetun(inspect, { overwrite });
  if (kind === "postgres") return importPostgres(inspect, { overwrite });
  if (kind === "instance") return importInstance(inspect);
  throw new Error(`Unknown import kind: ${kind}`);
}
