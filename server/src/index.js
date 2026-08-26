// StreamShare Suite — entry point.
//
// Phase 0 of the blueprint: the operations dashboard, backed by a database
// instead of environment variables, behind a real session login, and sitting
// outside gluetun's network namespace so later phases can manage that namespace
// without severing their own connection.

import { openDatabase } from "./store/db.js";
import { bootstrapFromEnv } from "./store/bootstrap.js";
import { pruneExpiredSessions } from "./auth/sessions.js";
import { countUsers } from "./auth/users.js";
import { countInstances } from "./store/instances.js";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.SUITE_DATA_DIR || "/data";

openDatabase(DATA_DIR);

const imported = bootstrapFromEnv();
if (imported.imported) {
  console.log(
    `[startup] Imported ${imported.instances} instance(s) and ${imported.settings} setting(s) ` +
      `from the environment. The store is now the source of truth — further changes belong in the UI.`
  );
}

pruneExpiredSessions();
// Sessions expire on read, so this is only housekeeping for rows nobody comes
// back for. Daily is plenty; unref so it never holds the process open.
setInterval(pruneExpiredSessions, 24 * 60 * 60 * 1000).unref();

createApp().listen(PORT, () => {
  const config = loadConfig();
  const setup = countUsers() === 0 ? " — no admin yet, open the UI to finish setup" : "";
  console.log(
    `[startup] ${config.title} listening on :${PORT} — ${countInstances()} instance(s) configured${setup}`
  );
});
