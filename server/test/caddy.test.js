// Caddy: the Caddyfile is generated from whichever instances have a public
// base URL set, and the spec hash has to move whenever that generated file's
// content does — see reconcile/caddy.js's header for why.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderCaddyfile, renderCaddySpec, caddyContainerName, dnsChallenge, CADDY_START_SCRIPT } from "../src/reconcile/caddy.js";
import { MODULE_PATH } from "../src/schema/dnsModule.js";
import { computeSpecHash } from "../src/docker/spec.js";
import { getCatalogEntry, isCaddyEnabled, CADDY_ENABLED_SETTING } from "../src/reconcile/catalog.js";
import { setSetting } from "../src/store/settings.js";
import { saveComponentValues } from "../src/store/components.js";
import { provisionInstance } from "../src/reconcile/provisioning.js";
import { freshDatabase } from "./helpers.js";
import { validate } from "../src/schema/registry.js";
import { CADDY_SCHEMA } from "../src/schema/caddy.js";

let root;

after(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  delete process.env.SUITE_DATA_DIR;
});

beforeEach(() => {
  freshDatabase();
  root = mkdtempSync(path.join(tmpdir(), "suite-caddy-"));
  process.env.SUITE_DATA_DIR = root;
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

// --- dashboard route -------------------------------------------------------

const SUITE_TARGET = "http://stream-share-suite:3000";

test("a dashboard URL alone becomes a site block proxying to the Suite, with no placeholder", () => {
  const file = renderCaddyfile({ dashboardUrl: "https://suite.example.com" }, SUITE_TARGET);
  assert.match(file, /suite\.example\.com \{/);
  assert.match(file, /\treverse_proxy http:\/\/stream-share-suite:3000\n/);
  assert.equal(file.includes("handle"), false);
  assert.equal(file.includes("StreamShare's Caddy is running"), false);
});

test("the dashboard and an instance on different hostnames get separate site blocks", () => {
  provisionInstance(PROVIDER("Provider 1", null, "https://tv.example.com/provider-1"));
  const file = renderCaddyfile({ dashboardUrl: "https://suite.example.com" }, SUITE_TARGET);
  assert.match(file, /tv\.example\.com \{/);
  assert.match(file, /suite\.example\.com \{/);
});

test("a dashboard sharing a hostname with path-based instances is the fallback handle, after the handle_path blocks", () => {
  provisionInstance(PROVIDER("Provider 1", null, "https://tv.example.com/provider-1"));
  const file = renderCaddyfile({ dashboardUrl: "https://tv.example.com" }, SUITE_TARGET);
  const blocks = file.split("\n\n").filter((b) => b.includes("tv.example.com {"));
  assert.equal(blocks.length, 1);
  const block = blocks[0];
  assert.ok(block.indexOf("handle_path /provider-1*") < block.indexOf("handle {"));
  assert.match(block, /handle \{\n\t\treverse_proxy http:\/\/stream-share-suite:3000\n\t\}/);
});

test("only the host of the dashboard URL is used; a path on it is ignored", () => {
  const file = renderCaddyfile({ dashboardUrl: "https://suite.example.com/some/path" }, SUITE_TARGET);
  assert.match(file, /suite\.example\.com \{/);
  assert.equal(file.includes("handle"), false);
  assert.equal(file.includes("/some/path"), false);
});

test("a blank, unparseable, or targetless dashboard URL adds no dashboard block", () => {
  for (const [values, target] of [
    [{}, SUITE_TARGET],
    [{ dashboardUrl: "" }, SUITE_TARGET],
    [{ dashboardUrl: "not a url" }, SUITE_TARGET],
    [{ dashboardUrl: "suite.example.com:8443" }, SUITE_TARGET],
    [{ dashboardUrl: "https://suite.example.com" }, undefined],
  ]) {
    assert.match(renderCaddyfile(values, target), /StreamShare's Caddy is running/);
  }
});

test("an instance whose public base URL has no scheme is not routed", () => {
  provisionInstance(PROVIDER("Provider 1", null, "tv.example.com:8443"));
  assert.match(renderCaddyfile({}), /StreamShare's Caddy is running/);
});

test("the dashboard block follows the TLS mode like any other site block", () => {
  const file = renderCaddyfile({ dashboardUrl: "https://suite.example.com", tlsMode: "internal" }, SUITE_TARGET);
  assert.match(file, /suite\.example\.com \{\n\ttls internal\n/);
});

test("the spec hash changes when the dashboard URL changes, and the Suite's address comes from self-inspection", async () => {
  const original = process.env.DOCKER_PROXY_URL;
  process.env.DOCKER_PROXY_URL = "http://127.0.0.1:1"; // unreachable: getSelfContainerName falls back
  try {
    const before = computeSpecHash(await renderCaddySpec({}));
    const spec = await renderCaddySpec({ dashboardUrl: "https://suite.example.com" });
    assert.notEqual(before, computeSpecHash(spec));

    const caddyfilePath = spec.volumes.find((v) => v.includes("Caddyfile")).split(":")[0];
    assert.match(readFileSync(caddyfilePath, "utf8"), /reverse_proxy http:\/\/stream-share-suite:\d+/);
  } finally {
    if (original === undefined) delete process.env.DOCKER_PROXY_URL;
    else process.env.DOCKER_PROXY_URL = original;
  }
});

// --- DNS challenge ---------------------------------------------------------

test("dnsChallenge is null outside DNS mode", () => {
  const dns = { dnsModule: "github.com/caddy-dns/hetzner@v2.0.1", dnsDirective: "hetzner {env.T}" };
  assert.equal(dnsChallenge({ tlsMode: "internal", ...dns }), null);
  assert.equal(dnsChallenge({ tlsMode: "acme", ...dns }), null);
  assert.equal(dnsChallenge({}), null);
});

test("dnsChallenge uses the typed directive collapsed to one line, the module, and the parsed env", () => {
  const challenge = dnsChallenge({
    tlsMode: "dns",
    dnsModule: "github.com/caddy-dns/porkbun@v1.2.3",
    dnsDirective: "porkbun {env.PORKBUN_API_KEY}\n {env.PORKBUN_API_SECRET_KEY}",
    dnsEnv: "PORKBUN_API_KEY=k\nPORKBUN_API_SECRET_KEY=s\n# a comment\n",
  });
  assert.equal(challenge.directive, "porkbun {env.PORKBUN_API_KEY} {env.PORKBUN_API_SECRET_KEY}");
  assert.deepEqual(challenge.env, { PORKBUN_API_KEY: "k", PORKBUN_API_SECRET_KEY: "s" });
  assert.deepEqual(challenge.modules, ["github.com/caddy-dns/porkbun@v1.2.3"]);
});

test("dnsChallenge is null when the directive or module is missing or invalid", () => {
  assert.equal(dnsChallenge({ tlsMode: "dns", dnsDirective: "  " }), null); // blank directive
  assert.equal(dnsChallenge({ tlsMode: "dns", dnsDirective: "porkbun {env.K}" }), null); // no module

  const base = { tlsMode: "dns", dnsDirective: "porkbun {env.K}" };
  assert.equal(dnsChallenge({ ...base, dnsModule: "porkbun; rm -rf /" }), null); // not a package path
  assert.notEqual(dnsChallenge({ ...base, dnsModule: "github.com/caddy-dns/porkbun@v1.2.3" }), null);
});

test("a propagation delay is kept when it is a Go duration and ignored otherwise", () => {
  const base = { tlsMode: "dns", dnsModule: "github.com/caddy-dns/hetzner@v2.0.1", dnsDirective: "hetzner {env.T}" };
  assert.equal(dnsChallenge({ ...base, dnsPropagationDelay: "30s" }).propagationDelay, "30s");
  assert.equal(dnsChallenge({ ...base, dnsPropagationDelay: "1m30s" }).propagationDelay, "1m30s");
  assert.equal(dnsChallenge({ ...base, dnsPropagationDelay: "soon" }).propagationDelay, null);
  assert.equal(dnsChallenge({ ...base, dnsPropagationDelay: "" }).propagationDelay, null);
});

test("DNS mode requires the ACME email, and the DNS fields only matter in DNS mode", () => {
  const dns = { tlsMode: "dns", dnsModule: "github.com/caddy-dns/hetzner@v2.0.1", dnsDirective: "hetzner {env.T}" };
  assert.ok(validate(CADDY_SCHEMA, dns).some((e) => e.key === "acmeEmail"));
  assert.deepEqual(validate(CADDY_SCHEMA, { ...dns, acmeEmail: "a@example.com" }), []);

  // Nothing DNS-related is required, or even visible, in the other modes.
  assert.deepEqual(validate(CADDY_SCHEMA, { tlsMode: "internal" }), []);
  assert.deepEqual(validate(CADDY_SCHEMA, { tlsMode: "acme", acmeEmail: "a@example.com" }), []);
});

test("DNS mode needs a directive and a module, always", () => {
  const email = { tlsMode: "dns", acmeEmail: "a@example.com" };
  const errors = validate(CADDY_SCHEMA, email);
  assert.ok(errors.some((e) => e.key === "dnsDirective"));
  assert.ok(errors.some((e) => e.key === "dnsModule"));
  assert.deepEqual(
    validate(CADDY_SCHEMA, {
      ...email,
      dnsDirective: "porkbun {env.K}",
      dnsModule: "github.com/caddy-dns/porkbun@v1.2.3",
    }),
    []
  );
});

test("dnsProvider and dnsApiToken no longer exist on the schema", () => {
  const keys = CADDY_SCHEMA.fields.map((f) => f.key);
  assert.equal(keys.includes("dnsProvider"), false);
  assert.equal(keys.includes("dnsApiToken"), false);
});

const DNS = {
  tlsMode: "dns",
  acmeEmail: "admin@example.com",
  dnsModule: "github.com/caddy-dns/hetzner@v2.0.1",
  dnsDirective: "hetzner {env.HETZNER_API_TOKEN}",
  dnsEnv: "HETZNER_API_TOKEN=secret-token",
};

test("DNS mode writes the global email and a tls { dns ... } block per site, never tls internal", () => {
  provisionInstance(PROVIDER("Provider 1", null, "https://tv.example.com/p1"));
  const file = renderCaddyfile(DNS);
  assert.match(file, /email admin@example\.com/);
  assert.match(file, /tv\.example\.com \{\n\ttls \{\n\t\tdns hetzner \{env\.HETZNER_API_TOKEN\}\n\t\}\n/);
  assert.equal(file.includes("tls internal"), false);
});

test("the DNS tls block appears in every site block, the dashboard's included", () => {
  provisionInstance(PROVIDER("Provider 1", null, "https://tv.example.com/p1"));
  const file = renderCaddyfile(
    { ...DNS, dashboardUrl: "https://suite.example.com" },
    "http://stream-share-suite:3000"
  );
  assert.equal(file.match(/\ttls \{/g).length, 2);
});

test("propagation_delay is written only when set, inside the same tls block", () => {
  provisionInstance(PROVIDER("Provider 1", null, "https://tv.example.com/p1"));

  const withDelay = renderCaddyfile({ ...DNS, dnsPropagationDelay: "30s" });
  assert.match(withDelay, /\t\tdns hetzner \{env\.HETZNER_API_TOKEN\}\n\t\tpropagation_delay 30s\n\t\}/);

  assert.equal(renderCaddyfile(DNS).includes("propagation_delay"), false);
});

test("the Caddyfile never contains the token, only the env placeholder", () => {
  provisionInstance(PROVIDER("Provider 1", null, "https://tv.example.com/p1"));
  const file = renderCaddyfile(DNS);
  assert.equal(file.includes("secret-token"), false);
  assert.match(file, /\{env\.HETZNER_API_TOKEN\}/);
});

test("a directive is written as typed", () => {
  provisionInstance(PROVIDER("Provider 1", null, "https://tv.example.com/p1"));
  const file = renderCaddyfile({
    tlsMode: "dns",
    acmeEmail: "admin@example.com",
    dnsDirective: "porkbun {env.PORKBUN_API_KEY} {env.PORKBUN_API_SECRET_KEY}",
    dnsModule: "github.com/caddy-dns/porkbun@v1.2.3",
  });
  assert.match(file, /\t\tdns porkbun \{env\.PORKBUN_API_KEY\} \{env\.PORKBUN_API_SECRET_KEY\}\n/);
});

test("renderCaddySpec carries the token in env and the spec hash moves with it", async () => {
  const spec = await renderCaddySpec(DNS);
  assert.equal(spec.env.HETZNER_API_TOKEN, "secret-token");
  assert.ok(spec.env.CADDY_CONFIG_HASH);

  const other = await renderCaddySpec({ ...DNS, dnsEnv: "HETZNER_API_TOKEN=another-token" });
  assert.notEqual(computeSpecHash(spec), computeSpecHash(other));
});

test("the env reaches the container, and CADDY_CONFIG_HASH cannot be overridden by it", async () => {
  const spec = await renderCaddySpec({
    tlsMode: "dns",
    acmeEmail: "admin@example.com",
    dnsDirective: "porkbun {env.PORKBUN_API_KEY}",
    dnsModule: "github.com/caddy-dns/porkbun@v1.2.3",
    dnsEnv: "PORKBUN_API_KEY=k\nCADDY_CONFIG_HASH=spoofed",
  });
  assert.equal(spec.env.PORKBUN_API_KEY, "k");
  assert.notEqual(spec.env.CADDY_CONFIG_HASH, "spoofed");
});

test("outside DNS mode the container env is just the config hash", async () => {
  assert.deepEqual(Object.keys((await renderCaddySpec({})).env), ["CADDY_CONFIG_HASH"]);
  assert.deepEqual(Object.keys((await renderCaddySpec({ tlsMode: "acme", acmeEmail: "a@example.com" })).env), [
    "CADDY_CONFIG_HASH",
  ]);
});

test("MODULE_PATH accepts Go package paths (with an optional version) and rejects anything shell-shaped", () => {
  for (const ok of [
    "github.com/caddy-dns/hetzner/v2",
    "github.com/caddy-dns/porkbun",
    "github.com/caddy-dns/porkbun@v1.2.3",
  ]) {
    assert.ok(MODULE_PATH.test(ok), ok);
  }
  for (const bad of [
    "",
    "porkbun",
    "github.com/a b/c",
    "github.com/x/y;rm -rf /",
    "github.com/x/$(id)",
    "github.com/x/`id`",
    'github.com/x/"y"',
    "github.com/x/y@v1 ; id",
  ]) {
    assert.equal(MODULE_PATH.test(bad), false, JSON.stringify(bad));
  }
});

test("in DNS mode the container command adds the configured module, and the spec hash moves when it changes", async () => {
  const hetzner = await renderCaddySpec(DNS);
  assert.deepEqual(hetzner.command, ["sh", "-c", CADDY_START_SCRIPT, "sh", "github.com/caddy-dns/hetzner@v2.0.1"]);

  const base = { tlsMode: "dns", acmeEmail: "admin@example.com", dnsDirective: "porkbun {env.PORKBUN_API_KEY}" };
  const plain = await renderCaddySpec({ ...base, dnsModule: "github.com/caddy-dns/porkbun" });
  const pinned = await renderCaddySpec({ ...base, dnsModule: "github.com/caddy-dns/porkbun@v1.2.3" });
  assert.deepEqual(plain.command.slice(4), ["github.com/caddy-dns/porkbun"]);
  assert.notEqual(computeSpecHash(plain), computeSpecHash(pinned));
});

test("outside DNS mode the container has no command override", async () => {
  assert.equal("command" in (await renderCaddySpec({})), false);
  assert.equal("command" in (await renderCaddySpec({ tlsMode: "acme", acmeEmail: "a@example.com" })), false);
});

test("the image is never checked for readiness", () => {
  const entry = getCatalogEntry("caddy");
  const dns = {
    tlsMode: "dns",
    dnsDirective: "hetzner {env.T}",
    dnsModule: "github.com/caddy-dns/hetzner@v2.0.1",
    dnsEnv: "T=x",
  };
  assert.equal(entry.ready({ ...dns, image: "caddy:2-alpine" }), null);
  assert.equal(entry.ready({ ...dns, image: "" }), null);
  assert.equal(entry.ready({ tlsMode: "acme" }), null);
  assert.equal(entry.ready({}), null);
});

test("DNS mode needs a directive and a valid module to be ready", () => {
  const entry = getCatalogEntry("caddy");
  assert.match(
    entry.ready({ tlsMode: "dns", dnsDirective: "   ", dnsModule: "github.com/caddy-dns/porkbun@v1.2.3" }),
    /needs a directive/
  );
  assert.match(entry.ready({ tlsMode: "dns", dnsDirective: "porkbun {env.K}" }), /needs a Caddy module/);
  assert.match(
    entry.ready({ tlsMode: "dns", dnsDirective: "porkbun {env.K}", dnsModule: "porkbun; id" }),
    /needs a Caddy module/
  );
});

test("DNS mode is not ready when the directive references a variable dnsEnv does not supply", () => {
  const entry = getCatalogEntry("caddy");
  const base = { tlsMode: "dns", dnsModule: "github.com/caddy-dns/hetzner@v2.0.1" };
  assert.match(
    entry.ready({ ...base, dnsDirective: "hetzner {env.HETZNER_API_TOKEN}" }),
    /Directive references HETZNER_API_TOKEN but no value is set/
  );
  assert.match(
    entry.ready({ ...base, dnsDirective: "porkbun {env.A} {env.B}", dnsEnv: "A=x" }),
    /Directive references B but no value is set/
  );
  assert.equal(
    entry.ready({ ...base, dnsDirective: "hetzner {env.HETZNER_API_TOKEN}", dnsEnv: "HETZNER_API_TOKEN=tok" }),
    null
  );
});

test("DNS mode is ready when the directive references no {env.*} names at all", () => {
  const entry = getCatalogEntry("caddy");
  assert.equal(
    entry.ready({
      tlsMode: "dns",
      dnsDirective: "hetzner literal-token",
      dnsModule: "github.com/caddy-dns/hetzner@v2.0.1",
    }),
    null
  );
});
