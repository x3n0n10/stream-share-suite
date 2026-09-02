// Creating and removing StreamShare instances.
//
// An instance is not just a row: it needs a port nothing else has taken, an
// API key so the dashboard can reach it without anyone typing one, and a
// database and role of its own. Those are generated here, at creation, rather
// than at render time — a plan has to stay side-effect-free, and a port that
// was allocated during planning would drift every time the page was refreshed.
//
// The generated values live in the component's stored config under keys the
// schema does not declare. applyPatch preserves unknown existing keys, so a
// later edit through the form cannot wipe them, and toPublicFields only
// projects declared fields, so they never reach the API either.

import { randomUUID } from "node:crypto";
import {
  getComponentValues,
  saveComponentValues,
  deleteComponent,
  listComponents,
} from "../store/components.js";
import { listInstances } from "../store/instances.js";
import { allocatePort, instanceContainerName } from "./instance.js";
import { databaseNamesFor, generatePassword, ensureDatabase, dropDatabase } from "./database.js";
import { connectionTarget } from "./postgres.js";
import { inspectContainer, stopContainer, removeContainer } from "../docker/client.js";
import { isManaged } from "../docker/labels.js";

// The key doubles as the instance's id in the ops API, so it has to be unique
// against the externally-configured instances in the other table too — not
// just against other components.
export function instanceKeyFor(displayName) {
  const base =
    String(displayName || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "instance";

  const taken = new Set([
    ...listComponents("instance").map((row) => row.key),
    ...listInstances({ includeDisabled: true }).map((instance) => instance.id),
  ]);

  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}

export function provisionInstance(values) {
  const key = instanceKeyFor(values.displayName);
  const port = allocatePort();

  if (port === null) {
    throw new Error("No ports left in the allocation band. Free one, or set this instance's port by hand.");
  }

  const names = databaseNamesFor(key);

  saveComponentValues(
    "instance",
    {
      ...values,
      port: String(port),
      _apiKey: randomUUID(),
      _dbName: names.database,
      _dbUser: names.user,
      _dbPassword: generatePassword(),
    },
    key
  );

  return { key, port };
}

// Removing an instance is a deliberate, name-confirmed action (see the
// Stack page's own dialog), so it takes the container down as part of
// removal rather than leaving it running as an orphan for a separate step —
// unlike a container that becomes unclaimed as a side effect of something
// else (the VPN switched off, a config edit), which is left alone exactly
// because nobody explicitly asked for it to go.
//
// The container comes down BEFORE the database is touched, not after:
// dropping a database an instance still holds connections against fails in
// PostgreSQL ("database is being accessed by other users") instead of
// succeeding against one that's already gone. The database is still
// a separate decision from the container either way — kept unless dropData
// is asked for outright, because a container is trivially rebuilt and watch
// history is not.
export async function deprovisionInstance(key, { dropData = false, log = () => {} } = {}) {
  const values = getComponentValues("instance", key);
  if (!values || Object.keys(values).length === 0) return false;

  const name = instanceContainerName(key, values);
  const existing = await inspectContainer(name);

  if (existing && isManaged(existing.Config?.Labels || {})) {
    log(`Stopping ${name}...`);
    await stopContainer(existing.Id, { timeoutSeconds: 30 });
    log(`Removing ${name}...`);
    await removeContainer(existing.Id, { force: true });
  } else if (existing) {
    // Adopted, not ours to stop — the same invariant Adopt itself rests on.
    // If dropData is also asked for, the drop below may fail while this is
    // still connected to it; there is no way around that without touching a
    // container the Suite was never allowed to touch.
    log(`${name} was not created by the Suite — leaving it running.`);
  }

  if (dropData && values._dbName) {
    const target = connectionTarget(getComponentValues("postgres"));
    if (!target.host) {
      throw new Error("Cannot drop the database: no PostgreSQL server is configured.");
    }
    await dropDatabase(target, { database: values._dbName, user: values._dbUser }, { log });
  } else if (values._dbName) {
    log(`Keeping database ${values._dbName}. Remove it yourself if you want it gone.`);
  }

  deleteComponent("instance", key);
  log(`Removed ${name} from the stack.`);
  return true;
}

// Called before an instance's container is created or recreated, so the
// database it is about to connect to already exists. Never called for a noop:
// there is nothing to prepare for a container that is not being touched.
export async function prepareInstance(key, values, { log = () => {} } = {}) {
  if (!values._dbName) return;

  const target = connectionTarget(getComponentValues("postgres"));
  if (!target.host) {
    throw new Error(
      "No PostgreSQL server is configured, so this instance has nowhere to store its data. Configure the database component first."
    );
  }

  await ensureDatabase(
    target,
    { database: values._dbName, user: values._dbUser, password: values._dbPassword },
    { log }
  );
}
