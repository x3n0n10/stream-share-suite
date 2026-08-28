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

// Postgres lowercases unquoted identifiers and allows a limited character set;
// deriving from the slug keeps names predictable without needing quoting.
export function databaseNamesFor(key) {
  const safe = String(key).toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40) || "instance";
  return { database: `streamshare_${safe}`, user: `streamshare_${safe}` };
}

export function generatePassword() {
  return randomBytes(24).toString("base64url");
}

async function withAdminClient(target, fn) {
  const client = new pg.Client({
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
    database: "postgres",
    connectionTimeoutMillis: 8000,
  });

  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
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
      log(`Creating database role ${user}...`);
      await client.query(`CREATE ROLE ${quoteIdent(user)} LOGIN PASSWORD ${quoteLiteral(password)}`);
    } else {
      // The stored password is the only copy, so an existing role is realigned
      // to it rather than left with a password nobody has.
      log(`Role ${user} already exists — updating its password to the stored one.`);
      await client.query(`ALTER ROLE ${quoteIdent(user)} LOGIN PASSWORD ${quoteLiteral(password)}`);
    }

    const dbExists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);

    if (dbExists.rowCount === 0) {
      log(`Creating database ${database}...`);
      // CREATE DATABASE cannot run inside a transaction block, which is why
      // this is a bare query rather than part of one.
      await client.query(`CREATE DATABASE ${quoteIdent(database)} OWNER ${quoteIdent(user)}`);
    } else {
      log(`Database ${database} already exists — leaving it exactly as it is.`);
    }

    return { database, user };
  });
}

// Separate from removing an instance, and never called by an apply.
export async function dropDatabase(target, { database, user }, { log = () => {} } = {}) {
  return withAdminClient(target, async (client) => {
    log(`Dropping database ${database}...`);
    await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(database)}`);
    log(`Dropping role ${user}...`);
    await client.query(`DROP ROLE IF EXISTS ${quoteIdent(user)}`);
    log("Done.");
  });
}

// Used by the instance form's "test connection" equivalent: proves the admin
// credentials work before anything depends on them.
export async function testConnection(target) {
  try {
    await withAdminClient(target, (client) => client.query("SELECT 1"));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
