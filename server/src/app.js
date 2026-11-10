// Builds the express app. Kept separate from index.js so tests can mount it
// without opening a real data directory or binding a port.

import express from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { attachSession } from "./auth/middleware.js";
import { createApiRouter } from "./routes/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ serveStatic = true } = {}) {
  const app = express();
  app.disable("x-powered-by");
  // Cookies must be able to carry Secure when Caddy terminates TLS in front.
  app.set("trust proxy", true);

  // On every response, API and UI alike. Everything the UI loads comes from
  // this origin; inline styles stay allowed because React sets style props.
  // frame-ancestors and X-Frame-Options stop another site framing the admin
  // UI to trick clicks.
  app.use((req, res, next) => {
    res.set({
      "Content-Security-Policy":
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    next();
  });

  app.use("/api", express.json({ limit: "256kb" }), attachSession, createApiRouter());

  // Liveness only — deliberately unauthenticated, and deliberately not a
  // readiness check for anything downstream. It says this process is up.
  app.get("/healthz", (req, res) => res.json({ status: "ok" }));

  if (serveStatic) {
    const staticDir = path.join(__dirname, "..", "public");
    if (existsSync(staticDir)) {
      app.use(express.static(staticDir));
      app.get("*", (req, res) => res.sendFile(path.join(staticDir, "index.html")));
    }
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    console.error("[error]", err);
    if (res.headersSent) return;
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
