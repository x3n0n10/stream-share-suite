// The UHF server component: schema validation, the two topologies the VPN
// toggle produces (same shape as an instance's), and the stack-wide switch
// that keeps it out of the plan until asked for.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { UHF_SCHEMA } from "../src/schema/uhf.js";
import { validate } from "../src/schema/registry.js";
import { renderUhfSpec, uhfContainerName, uhfUrl, uhfPort } from "../src/reconcile/uhf.js";
import { getCatalogEntry, isUhfEnabled, UHF_ENABLED_SETTING } from "../src/reconcile/catalog.js";
import { setSetting } from "../src/store/settings.js";
import { saveComponentValues } from "../src/store/components.js";
import { provisionInstance } from "../src/reconcile/provisioning.js";
import { freshDatabase } from "./helpers.js";

let root;

before(() => {});

after(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  delete process.env.SUITE_DATA_DIR;
  delete process.env.SUITE_CACHE_DIR;
});

beforeEach(() => {
  freshDatabase();
  root = mkdtempSync(path.join(tmpdir(), "suite-uhf-"));
  process.env.SUITE_DATA_DIR = root;
  process.env.SUITE_CACHE_DIR = root;
  saveComponentValues("postgres", {
    mode: "external",
    host: "db.example",
    port: "5432",
    adminUser: "postgres",
    adminPassword: "x",
  });
});

test("an empty port resolves to the schema default rather than failing validation", () => {
  const errors = validate(UHF_SCHEMA, { port: "" });
  assert.equal(errors.some((e) => e.key === "port"), false);
});

test("port defaults to 8000 when unset", () => {
  assert.equal(uhfPort({}), 8000);
});

test("switched off by default — not part of the stack until the setting is turned on", () => {
  assert.equal(isUhfEnabled(), false);
  assert.equal(getCatalogEntry("uhf").present(), false);
});

test("turning the setting on brings uhf into the stack", () => {
  setSetting(UHF_ENABLED_SETTING, "true");
  assert.equal(getCatalogEntry("uhf").present(), true);
});

test("with the VPN on, uhf shares gluetun's namespace and publishes no ports of its own", async () => {
  const spec = await renderUhfSpec({ port: "8000" });
  assert.equal(spec.networkMode, "container:streamshare-suite-gluetun");
  assert.equal(spec.networks, undefined);
  assert.equal(spec.ports, undefined);
});

test("with the VPN off, uhf joins postgres's network and publishes its own port", async () => {
  setSetting("stack.vpn_enabled", "false");
  const spec = await renderUhfSpec({ port: "9001" });
  assert.deepEqual(spec.networks, ["streamshare"]);
  assert.deepEqual(spec.ports, [{ host: 9001, container: 9001, protocol: "tcp" }]);
});

test("PORT and RECORDINGS_DIR are always set", async () => {
  const spec = await renderUhfSpec({ port: "8010" });
  assert.equal(spec.env.PORT, "8010");
  assert.equal(spec.env.RECORDINGS_DIR, "/recordings");
});

test("password renders as PASSWORD when set, and is absent otherwise", async () => {
  const withPassword = await renderUhfSpec({ port: "8000", password: "secret" });
  assert.equal(withPassword.env.PASSWORD, "secret");

  const withoutPassword = await renderUhfSpec({ port: "8000" });
  assert.equal("PASSWORD" in withoutPassword.env, false);
});

test("the image falls back to the schema default when unset", async () => {
  const spec = await renderUhfSpec({ port: "8000" });
  assert.equal(spec.image, "swapplications/uhf-server:latest");
});

test("an explicit image overrides the default", async () => {
  const spec = await renderUhfSpec({ port: "8000", image: "solidpixel/uhf-server-docker:latest" });
  assert.equal(spec.image, "solidpixel/uhf-server-docker:latest");
});

test("the container name defaults to the Suite's prefix plus uhf", async () => {
  const spec = await renderUhfSpec({ port: "8000" });
  assert.equal(spec.name, "streamshare-suite-uhf");
  assert.equal(spec.name, uhfContainerName({}));
});

test("an explicit containerName overrides the prefixed default, for adopting an existing container", async () => {
  const spec = await renderUhfSpec({ port: "8000", containerName: "my-uhf" });
  assert.equal(spec.name, "my-uhf");
});

test("extraEnv fills in unmodeled variables without overriding a named field", async () => {
  const spec = await renderUhfSpec({ port: "8000", extraEnv: "RECORDINGS_DIR=/should-not-win\nFOO=bar" });
  assert.equal(spec.env.RECORDINGS_DIR, "/recordings");
  assert.equal(spec.env.FOO, "bar");
});

test("ready() rejects a port that clashes with an instance's allocated port", () => {
  setSetting(UHF_ENABLED_SETTING, "true");
  provisionInstance({
    displayName: "Provider 1",
    xtreamBaseUrl: "http://p.example",
    xtreamUser: "u",
    xtreamPassword: "p",
    authMode: "basic",
    authUser: "v",
    authPassword: "s",
  });
  // The instance above lands on the port band's first slot, 8080 — the
  // schema default UHF would otherwise also try to use.
  saveComponentValues("uhf", { port: "8080" });
  const message = getCatalogEntry("uhf").ready();
  assert.match(message, /already used by the "provider-1" instance/);
});

test("ready() is happy once the clash is resolved", () => {
  setSetting(UHF_ENABLED_SETTING, "true");
  provisionInstance({
    displayName: "Provider 1",
    xtreamBaseUrl: "http://p.example",
    xtreamUser: "u",
    xtreamPassword: "p",
    authMode: "basic",
    authUser: "v",
    authPassword: "s",
  });
  saveComponentValues("uhf", { port: "9000" });
  assert.equal(getCatalogEntry("uhf").ready(), null);
});

test("uhfUrl follows gluetun's address with the VPN on, and its own container name with it off", () => {
  assert.equal(uhfUrl({ port: "8000" }), "http://streamshare-suite-gluetun:8000");

  setSetting("stack.vpn_enabled", "false");
  assert.equal(uhfUrl({ port: "8000" }), "http://streamshare-suite-uhf:8000");
});
