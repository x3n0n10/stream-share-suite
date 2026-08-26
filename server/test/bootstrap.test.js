import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers.js";
import { bootstrapFromEnv } from "../src/store/bootstrap.js";
import { listInstances } from "../src/store/instances.js";
import { getSetting } from "../src/store/settings.js";
import { loadConfig } from "../src/config.js";

beforeEach(() => freshDatabase());

const ENV = {
  DASHBOARD_TITLE: "StreamShare Dashboard",
  POLL_INTERVAL_MS: "15000",
  INSTANCE_1_NAME: "Provider 1",
  INSTANCE_1_URL: "http://localhost:8080",
  INSTANCE_1_API_KEY: "shared-key",
  INSTANCE_2_NAME: "Provider 3",
  INSTANCE_2_URL: "http://localhost:8082",
  INSTANCE_2_API_KEY: "shared-key",
  GLUETUN_URL: "http://localhost:8000",
  GLUETUN_USER: "admin",
  GLUETUN_PASSWORD: "password",
};

test("an existing env deployment is imported once", () => {
  const result = bootstrapFromEnv(ENV);
  assert.equal(result.imported, true);
  assert.equal(result.instances, 2);

  assert.deepEqual(listInstances().map((i) => i.name), ["Provider 1", "Provider 3"]);
  assert.equal(listInstances()[0].apiKey, "shared-key");
  assert.equal(getSetting("general.title"), "StreamShare Dashboard");
});

test("numbering stops at the first gap, matching the old reader", () => {
  bootstrapFromEnv({
    INSTANCE_1_URL: "http://a:8080",
    INSTANCE_3_URL: "http://c:8080",
  });
  assert.equal(listInstances().length, 1);
});

test("a second run does not re-import, so UI edits are not overwritten", () => {
  bootstrapFromEnv(ENV);
  const again = bootstrapFromEnv(ENV);
  assert.equal(again.imported, false);
  assert.equal(again.reason, "already-imported");
  assert.equal(listInstances().length, 2);
});

test("an env-less first run leaves the marker unset so a later import still works", () => {
  const first = bootstrapFromEnv({});
  assert.equal(first.imported, false);
  assert.equal(first.reason, "nothing-to-import");

  // The operator adds their old compose env and restarts: it must still import.
  const second = bootstrapFromEnv(ENV);
  assert.equal(second.imported, true);
  assert.equal(listInstances().length, 2);
});

test("a store that already has instances is marked without importing", () => {
  bootstrapFromEnv({ INSTANCE_1_URL: "http://a:8080", INSTANCE_1_NAME: "Kept" });
  const result = bootstrapFromEnv(ENV);
  assert.equal(result.imported, false);
  assert.deepEqual(listInstances().map((i) => i.name), ["Kept"]);
});

test("imported settings feed straight into the runtime config", () => {
  bootstrapFromEnv(ENV);
  const config = loadConfig();

  assert.equal(config.title, "StreamShare Dashboard");
  assert.equal(config.pollIntervalMs, 15000);
  assert.equal(config.instances.length, 2);
  assert.equal(config.gluetun.url, "http://localhost:8000");
  // Basic auth wins when both it and an API key are present, because gluetun
  // maps a client to exactly one auth method.
  assert.deepEqual(config.gluetun.basicAuth, { user: "admin", password: "password" });
});

test("no gluetun URL means no VPN page at all", () => {
  bootstrapFromEnv({ INSTANCE_1_URL: "http://a:8080" });
  assert.equal(loadConfig().gluetun, null);
});

test("config falls back to defaults on an empty store", () => {
  const config = loadConfig();
  assert.equal(config.title, "StreamShare Suite");
  assert.equal(config.pollIntervalMs, 15000);
  assert.deepEqual(config.instances, []);
  assert.equal(config.gluetun, null);
});

test("floors are enforced so a saved value cannot read back lower", () => {
  bootstrapFromEnv({ POLL_INTERVAL_MS: "10", INSTANCE_TIMEOUT_MS: "1", INSTANCE_1_URL: "http://a:8080" });
  const config = loadConfig();
  assert.equal(config.pollIntervalMs, 5000);
  assert.equal(config.requestTimeoutMs, 1000);
});
