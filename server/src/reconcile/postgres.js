// Renders the postgres component to a container spec, and describes how to
// connect to it whichever mode it is in.

import { componentDataDir, ensureDirectory } from "../store/paths.js";

export const POSTGRES_CONTAINER_NAME = "stream-share-postgres";

// The directory postgres is told to use, one level below the mount point. The
// official image refuses to initialise into a directory that already contains
// anything it did not create, and a bind-mounted volume frequently does (a
// lost+found on some filesystems is enough), so pointing PGDATA at a
// subdirectory it owns outright is the standard way around it. Their own
// compose file does the same.
const PGDATA = "/var/lib/postgresql/data/pgdata";
const MOUNT = "/var/lib/postgresql/data";

export function isManaged(values) {
  return (values.mode || "managed") === "managed";
}

// Where anything that needs the database should connect. For a managed server
// that is the container's own name on the shared network; for an external one
// it is whatever was typed.
export function connectionTarget(values) {
  return {
    host: isManaged(values) ? POSTGRES_CONTAINER_NAME : String(values.host || "").trim(),
    port: Number(values.port || 5432),
    user: values.adminUser || "postgres",
    password: values.adminPassword || "",
  };
}

export async function renderPostgresSpec(values) {
  const dataDir = ensureDirectory(componentDataDir("postgres"), "data");

  const networks = String(values.networks || "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);

  return {
    name: POSTGRES_CONTAINER_NAME,
    image: values.image || "postgres:14-alpine",
    env: {
      POSTGRES_USER: values.adminUser || "postgres",
      POSTGRES_PASSWORD: values.adminPassword || "",
      // A database for the superuser to land in. Per-instance databases are
      // created separately; this one is never used by an instance.
      POSTGRES_DB: "postgres",
      PGDATA,
    },
    volumes: [`${dataDir}:${MOUNT}`],
    networks,
    // Deliberately no `user`: the postgres image starts as root, chowns its
    // data directory to its own postgres user, and drops privileges itself.
    // Pinning a uid here would break that and leave it unable to initialise.
    restartPolicy: "unless-stopped",
  };
}
