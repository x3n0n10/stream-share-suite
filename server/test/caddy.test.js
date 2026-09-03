// Caddy: the Caddyfile is generated from whichever instances have a public
// base URL set, and the spec hash has to move whenever that generated file's
// content does — see reconcile/caddy.js's header for why.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderCaddyfile, renderCaddySpec, caddyContainerName } from "../src/reconcile/caddy.js";
import { computeSpecHash } from "../src/docker/spec.js";
import { getCatalogEntry, isCaddyEnabled, CADDY_ENABLED_SETTING } from "../src/reconcile/catalog.js";
import { setSetting } from "../src/store/settings.js";
import { saveComponentValues } from "../src/store/components.js";
import { provisionInstance } from "../src/reconcile/provisioning.js";
import { freshDatabase } from "./helpers.js";

let root;

after(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  delete process.env.SUITE_DATA_DIR;
  delete process.env.SUITE_CACHE_DIR;
});

beforeEach(() => {
  freshDatabase();
  root = mkdtempSync(path.join(tmpdir(), "suite-caddy-"));
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

const PROVIDER = (name, port, publicBaseUrl) => ({
  displayName: name,
  xtreamBaseUrl: "http://p.example",
  xtreamUser: "u",
  xtreamPassword: "p",
  authMode: "basic",
  authUser: "v",
  authPassword: "s",
  publicBaseUrl,
});

test("switched off by default", () => {
  assert.equal(isCaddyEnabled(), false);
  assert.equal(getCatalogEntry("caddy").present(), false);
});

test("turning the setting on brings caddy into the stack", () => {
  setSetting(CADDY_ENABLED_SETTING, "true");
  assert.equal(getCatalogEntry("caddy").present(), true);
});

test("with no instance publishing a public base URL, the Caddyfile is a placeholder", () => {
  const file = renderCaddyfile({});
  assert.match(file, /StreamShare's Caddy is running/);
});

test("an instance's public base URL becomes a site block proxying to its computed address", () => {
  const { key } = provisionInstance(PROVIDER("Provider 1", null, "https://tv.example.com/provider-1"));
  const file = renderCaddyfile({});
  assert.match(file, /tv\.example\.com \{/);
  assert.match(file, /handle_path \/provider-1\* \{/);
  assert.match(file, /reverse_proxy http:\/\/streamshare-suite-gluetun:8080/);
  assert.notEqual(key, undefined);
});

test("a public base URL with no path gets a plain reverse_proxy, no handle_path", () => {
  provisionInstance(PROVIDER("Provider 1", null, "https://provider1.example.com"));
  const file = renderCaddyfile({});
  assert.match(file, /provider1\.example\.com \{/);
  assert.match(file, /\treverse_proxy http:\/\/streamshare-suite-gluetun:8080\n/);
  assert.equal(file.includes("handle_path"), false);
});

test("two instances sharing a hostname on different paths land in one site block", () => {
  provisionInstance(PROVIDER("Provider 1", null, "https://tv.example.com/provider-1"));
  provisionInstance(PROVIDER("Provider 2", null, "https://tv.example.com/provider-2"));
  const file = renderCaddyfile({});
  const blocks = file.split("\n\n").filter((b) => b.includes("tv.example.com"));
  assert.equal(blocks.length, 1);
  assert.match(blocks[0], /handle_path \/provider-1\*/);
  assert.match(blocks[0], /handle_path \/provider-2\*/);
});

test("an instance with no public base URL is not routed at all", () => {
  provisionInstance(PROVIDER("Provider 1", null, undefined));
  const file = renderCaddyfile({});
  assert.match(file, /StreamShare's Caddy is running/);
});

test("internal TLS mode adds tls internal to every site block; acme mode adds a global email instead", () => {
  provisionInstance(PROVIDER("Provider 1", null, "https://tv.example.com/p1"));

  const internal = renderCaddyfile({ tlsMode: "internal" });
  assert.match(internal, /tls internal/);

  const acme = renderCaddyfile({ tlsMode: "acme", acmeEmail: "admin@example.com" });
  assert.match(acme, /email admin@example\.com/);
  assert.equal(acme.includes("tls internal"), false);
});

test("extraCaddyfile is appended verbatim", () => {
  const file = renderCaddyfile({ extraCaddyfile: "example.com {\n\trespond \"hi\"\n}" });
  assert.match(file, /example\.com \{\n\trespond "hi"\n\}/);
});

test("renderCaddySpec writes the Caddyfile to the bind-mounted config directory", async () => {
  provisionInstance(PROVIDER("Provider 1", null, "https://tv.example.com/p1"));
  const spec = await renderCaddySpec({});
  const caddyfilePath = spec.volumes.find((v) => v.includes("Caddyfile")).split(":")[0];
  const written = readFileSync(caddyfilePath, "utf8");
  assert.match(written, /tv\.example\.com/);
});

test("the spec hash changes when the generated Caddyfile's content changes", async () => {
  const before = computeSpecHash(await renderCaddySpec({}));
  provisionInstance(PROVIDER("Provider 1", null, "https://tv.example.com/p1"));
  const after = computeSpecHash(await renderCaddySpec({}));
  assert.notEqual(before, after);
});

test("httpPort and httpsPort override the published host ports; the container side stays 80/443", async () => {
  const spec = await renderCaddySpec({ httpPort: "8080", httpsPort: "8443" });
  assert.deepEqual(spec.ports, [
    { host: 8080, container: 80, protocol: "tcp" },
    { host: 8443, container: 443, protocol: "tcp" },
  ]);
});

test("the networks field is parsed from a comma-separated string, defaulting to streamshare", async () => {
  const spec = await renderCaddySpec({});
  assert.deepEqual(spec.networks, ["streamshare"]);

  const custom = await renderCaddySpec({ networks: "ssbackend, streamshare" });
  assert.deepEqual(custom.networks, ["ssbackend", "streamshare"]);
});

test("the container name defaults to the Suite's prefix plus caddy, and an override wins", async () => {
  const spec = await renderCaddySpec({});
  assert.equal(spec.name, "streamshare-suite-caddy");
  assert.equal(spec.name, caddyContainerName({}));

  const overridden = await renderCaddySpec({ containerName: "my-caddy" });
  assert.equal(overridden.name, "my-caddy");
});

test("the image falls back to the schema default when unset", async () => {
  const spec = await renderCaddySpec({});
  assert.equal(spec.image, "caddy:2-alpine");
});
