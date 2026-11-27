// Creating an instance's database and role.
//
// Done with a PostgreSQL client rather than by exec'ing psql inside the
// postgres container, which would have meant granting the socket proxy EXEC —
// and exec into any container is root on the host. A pure-JS client is a much
// cheaper way to get the same result than widening what the Suite can do to
// Docker.
//
// Two safety properties, and they are the ones worth arguing about before
// anyone loses data rather than after:
//
//   Create if absent, never alter. A database that already exists under the
//   name is used as-is — never dropped, migrated or recreated. stream-share
//   builds its own tables with CREATE TABLE IF NOT EXISTS on startup, so there
//   is nothing for the Suite to migrate anyway.
//
//   Removing an instance never drops its database on its own. The container
//   goes, the data stays, and dropping it is a separate action that has to be
//   asked for explicitly.

import pg from "pg";
import { randomBytes } from "node:crypto";
import { SuiteError } from "../errors.js";

// Postgres lowercases unquoted identifiers and allows a limited character set;
// deriving from the slug keeps names predictable without needing quoting.
export function databaseNamesFor(key) {
  const safe = String(key).toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40) || "instance";
  return { database: `streamshare_${safe}`, user: `streamshare_${safe}` };
}

export function generatePassword() {
  return randomBytes(24).toString("base64url");
}

const NOT_UP_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "57P03"]);

// "Not up yet" covers a refused/reset connection, DNS for a container that has
// not registered yet, Postgres's own "starting up" (57P03) and pg's connect
// timeout. Anything else (bad password, missing database) is a real error.
export function isNotUpYet(err) {
  return NOT_UP_CODES.has(err?.code) || /timeout expired/i.test(err?.message ?? "");
}

// `open` creates and connects a fresh client (a pg.Client cannot be reused
// after a failed connect) and cleans up after itself when it rejects.
export async function connectWithRetry(open, {
  budgetMs = 60000,
  delayMs = 1000,
  log = () => {},
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  describe = "PostgreSQL",
} = {}) {
  const deadline = Date.now() + budgetMs;
  let warned = false;
  for (;;) {
    try {
      return await open();
    } catch (err) {
      if (!isNotUpYet(err)) throw err;
      if (Date.now() + delayMs > deadline) {
        const seconds = Math.round(budgetMs / 1000);
        throw new SuiteError(
          "postgres_wait_timeout",
          `PostgreSQL at ${describe} did not accept connections within ${seconds} s: ${err.message}`,
          { describe, seconds, message: err.message }
        );
      }
      if (!warned) {
        warned = true;
        log("Waiting for PostgreSQL to accept connections...", { code: "waiting_postgres" });
      }
      await sleep(delayMs);
    }
  }
}

async function withAdminClient(target, fn, { retry = true, log = () => {} } = {}) {
  const open = async () => {
    const client = new pg.Client({
      host: target.host,
      port: target.port,
      user: target.user,
      password: target.password,
      database: "postgres",
      connectionTimeoutMillis: 8000,
    });
    try {
      await client.connect();
    } catch (err) {
      await client.end().catch(() => {});
      throw err;
    }
    return client;
  };

  const client = retry
    ? await connectWithRetry(open, { log, describe: `${target.host}:${target.port}` })
    : await open();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

// SHOW server_version returns e.g. "16.4 (Debian 16.4-1.pgdg120+1)"; the
// distro suffix is noise in a sidebar.
export function parseServerVersion(raw) {
  const match = /^\d+(?:\.\d+)*/.exec(String(raw ?? "").trim());
  return match ? match[0] : null;
}

export async function serverVersion(target) {
  return withAdminClient(target, async (client) => {
    const result = await client.query("SHOW server_version");
    return parseServerVersion(result.rows[0]?.server_version);
  }, { retry: false });
}

// Identifiers cannot be parameterised in Postgres, so they are quoted rather
// than interpolated raw. Everything here is derived from a slug we generated,
// but quoting is what makes that a property of the code rather than of the
// caller remembering.
function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export async function ensureDatabase(target, { database, user, password }, { log = () => {} } = {}) {
  return withAdminClient(target, async (client) => {
    const roleExists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [user]);

    if (roleExists.rowCount === 0) {
      log(`Creating database role ${user}...`, { code: "creating_role", params: { user } });
      await client.query(`CREATE ROLE ${quoteIdent(user)} LOGIN PASSWORD ${quoteLiteral(password)}`);
    } else {
      // The stored password is the only copy, so an existing role is realigned
      // to it rather than left with a password nobody has.
      log(`Role ${user} already exists — updating its password to the stored one.`, { code: "role_exists", params: { user } });
      await client.query(`ALTER ROLE ${quoteIdent(user)} LOGIN PASSWORD ${quoteLiteral(password)}`);
    }

    // CREATE DATABASE ... OWNER needs the creator to be able to SET ROLE to the
    // owner. A CREATEROLE admin is not a member on PG14 and on PG16+ only gets
    // ADMIN OPTION. The grant stays because DROP DATABASE needs it later too.
    const me = await client.query(
      "SELECT rolsuper, current_setting('server_version_num')::int AS v FROM pg_roles WHERE rolname = current_user");
    if (!me.rows[0].rolsuper) {
      // WITH SET only exists from PG16; earlier versions have plain membership.
      await client.query(`GRANT ${quoteIdent(user)} TO CURRENT_USER${me.rows[0].v >= 160000 ? " WITH SET TRUE" : ""}`);
    }

    const dbExists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);

    if (dbExists.rowCount === 0) {
      log(`Creating database ${database}...`, { code: "creating_database", params: { database } });
      // CREATE DATABASE cannot run inside a transaction block, which is why
      // this is a bare query rather than part of one.
      await client.query(`CREATE DATABASE ${quoteIdent(database)} OWNER ${quoteIdent(user)}`);
    } else {
      log(`Database ${database} already exists — leaving it exactly as it is.`, { code: "database_exists", params: { database } });
    }

    return { database, user };
  }, { log });
}

// Separate from removing an instance, and never called by an apply.
export async function dropDatabase(target, { database, user }, { log = () => {} } = {}) {
  return withAdminClient(target, async (client) => {
    log(`Dropping database ${database}...`, { code: "dropping_database", params: { database } });
    await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(database)}`);
    log(`Dropping role ${user}...`, { code: "dropping_role", params: { user } });
    await client.query(`DROP ROLE IF EXISTS ${quoteIdent(user)}`);
    log("Done.", { code: "done" });
  }, { log });
}

// Used by the instance form's "test connection" equivalent: proves the admin
// credentials work before anything depends on them.
export async function testConnection(target) {
  try {
    await withAdminClient(target, (client) => client.query("SELECT 1"), { retry: false });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
