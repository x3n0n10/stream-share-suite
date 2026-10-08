// The sidebar's version endpoint over real HTTP: behind the auth gate, always
// answers even when everything it asks is unreachable, and cached.

import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase, apiClient, signedInClient } from "./helpers.js";
import { createApp } from "../src/app.js";
import { _resetLoginThrottle } from "../src/auth/middleware.js";
import { _resetVersionsCache } from "../src/reconcile/versions.js";
import { saveComponentValues } from "../src/store/components.js";
import { setSetting } from "../src/store/settings.js";
import { VPN_ENABLED_SETTING } from "../src/reconcile/catalog.js";

let server;
let base;

before(async () => {
  server = createApp({ serveStatic: false }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  // Nothing listens on port 1: Docker and PostgreSQL lookups fail fast.
  process.env.DOCKER_PROXY_URL = "http://127.0.0.1:1";
});

after(() => server.close());

beforeEach(() => {
  freshDatabase();
  _resetLoginThrottle();
  _resetVersionsCache();
  process.env.SUITE_VERSION = "9.9.9";
  setSetting(VPN_ENABLED_SETTING, "false");
  saveComponentValues("postgres", {
    mode: "external",
    host: "127.0.0.1",
    port: "1",
    adminUser: "postgres",
    adminPassword: "x",
  });
});

test("an anonymous caller is refused", async () => {
  const { status } = await apiClient(base).get("/api/stack/versions");
  assert.equal(status, 401);
});

test("reports the suite version and degrades every unreachable component to unknown", async () => {
  const c = await signedInClient(base);
  const { status, body } = await c.get("/api/stack/versions");

  assert.equal(status, 200);
  assert.deepEqual(body.suite, { version: "9.9.9" });
  assert.deepEqual(body.components, [
    { kind: "postgres", key: "", label: "PostgreSQL", status: "unknown", version: null, source: null },
  ]);
});

test("a second request inside the cache window is served from the cache", async () => {
  const c = await signedInClient(base);
  const first = await c.get("/api/stack/versions");
  assert.equal(first.body.suite.version, "9.9.9");

  process.env.SUITE_VERSION = "changed";
  const second = await c.get("/api/stack/versions");
  assert.equal(second.body.suite.version, "9.9.9", "cached response, not recomputed");
});
