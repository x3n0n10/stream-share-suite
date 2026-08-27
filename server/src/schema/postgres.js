// The PostgreSQL component: the database every StreamShare instance keeps its
// history, VOD cache index and IP aliases in.
//
// The Suite can run it as a container or connect to a server you already have
// — `mode` picks which, and the fields for the other one disappear. Either way
// it needs credentials that can CREATE DATABASE, because each instance gets a
// database and role of its own rather than sharing one.
//
// Deliberately absent: the per-instance database name, user and password.
// Those are derived from the instance's own key and generated on first apply,
// not asked for — see reconcile/database.js.

export const POSTGRES_SCHEMA = {
  kind: "postgres",
  label: "PostgreSQL",
  fields: [
    {
      key: "mode",
      envVar: null,
      label: "Where it runs",
      help: "Let the Suite run a PostgreSQL container, or point at a server you already have.",
      type: "select",
      options: ["managed", "external"],
      default: "managed",
      group: "Database",
      required: true,
    },

    // --- managed ------------------------------------------------------------
    {
      key: "image",
      envVar: null,
      label: "Image",
      help: "Any postgres tag. Changing this recreates the container; it does not migrate the data directory, so do not cross a major version this way.",
      group: "Database",
      default: "postgres:14-alpine",
      advanced: true,
      dependsOn: { key: "mode", equals: "managed" },
    },
    {
      key: "networks",
      envVar: null,
      label: "Docker networks to join",
      help: "Comma-separated. Must include the network your instances reach the database over.",
      group: "Database",
      required: true,
      advanced: true,
      dependsOn: { key: "mode", equals: "managed" },
    },

    // --- external -----------------------------------------------------------
    {
      key: "host",
      envVar: null,
      label: "Host",
      help: "Hostname or address the instances (and the Suite) reach the server at.",
      group: "Database",
      required: true,
      dependsOn: { key: "mode", equals: "external" },
    },

    // --- both ---------------------------------------------------------------
    {
      key: "port",
      envVar: null,
      label: "Port",
      group: "Database",
      default: "5432",
      advanced: true,
    },
    {
      key: "adminUser",
      envVar: null,
      label: "Administrator username",
      help: "Must be able to CREATE DATABASE and CREATE ROLE. For a managed server this is the superuser it is created with.",
      group: "Credentials",
      default: "postgres",
      required: true,
    },
    {
      key: "adminPassword",
      envVar: null,
      label: "Administrator password",
      group: "Credentials",
      secret: true,
      required: true,
    },
  ],
};
