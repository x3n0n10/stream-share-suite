// Mounts the API. The ordering here is the security boundary: /auth is public
// (it has to be — it answers "is there an admin yet"), everything after
// requireAuth is not.

import { Router } from "express";
import { loadConfig } from "../config.js";
import { requireAuth, requireCsrf } from "../auth/middleware.js";
import { createAuthRouter } from "./auth.js";
import { createSettingsRouter } from "./settings.js";
import { createOpsRouter } from "./ops.js";
import { createStackRouter } from "./stack.js";
import { createWatchdogRouter } from "./watchdog.js";

// Reads the store once per request and hands the result to the handlers. One
// read per request rather than one per handler keeps a single response
// internally consistent even if a setting changes mid-flight.
function withConfig(req, res, next) {
  req.config = loadConfig();
  next();
}

export function createApiRouter() {
  const router = Router();

  router.use("/auth", createAuthRouter());

  router.use(requireAuth);
  router.use(requireCsrf);
  router.use(withConfig);

  // What the frontend needs before it can render anything: title, poll cadence,
  // which instances exist, and whether the VPN page should appear at all.
  router.get("/config", (req, res) => {
    res.json({
      title: req.config.title,
      pollIntervalMs: req.config.pollIntervalMs,
      instances: req.config.instances.map(({ id, name, url }) => ({ id, name, url })),
      gluetun: { enabled: !!req.config.gluetun },
    });
  });

  router.use("/settings", createSettingsRouter());
  router.use("/stack", createStackRouter());
  router.use("/watchdog", createWatchdogRouter());
  router.use("/", createOpsRouter());

  return router;
}
