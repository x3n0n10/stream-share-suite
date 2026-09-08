// Instances: port allocation, computed URLs, the two topologies the VPN
// toggle produces, and the cascade finally firing against real components
// rather than synthetic nodes.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  renderInstanceSpec,
  instanceContainerName,
  instanceUrl,
  allocatePort,
  portBand,
  PORT_BAND_START_SETTING,
} from "../src/reconcile/instance.js";
import { renderGluetunSpec } from "../src/reconcile/gluetun.js";
import { provisionInstance, instanceKeyFor } from "../src/reconcile/provisioning.js";
import { databaseNamesFor } from "../src/reconcile/database.js";
import { planStack } from "../src/reconcile/reconciler.js";
import { VPN_ENABLED_SETTING } from "../src/reconcile/catalog.js";
import { setSetting } from "../src/store/settings.js";
import { saveComponentValues, getComponentValues } from "../src/store/components.js";
import { managedLabels } from "../src/docker/labels.js";
import { loadConfig } from "../src/config.js";
import { freshDatabase } from "./helpers.js";
import { INSTANCE_SCHEMA } from "../src/schema/instance.js";
import { validate, renderEnv, toPublicFields } from "../src/schema/registry.js";

let server;
let containers;
let root;

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    req.on("data", () => {});
    req.on("end", () => {
      if (req.method === "GET" && url.pathname === "/v1.43/containers/json") {
        const filters = JSON.parse(url.searchParams.get("filters") || "{}");
        const wanted = filters.label || [];
        const matches = [...containers.values()].filter((c) =>
          wanted.every((pair) => {
            const [k, v] = pair.split("=");
            return (c.Labels || {})[k] === v;
          })
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(
          JSON.stringify(matches.map((c) => ({ Id: c.Id, Names: [`/${c.name}`], Labels: c.Labels })))
        );
      }

      const m = url.pathname.match(/^\/v1\.43\/containers\/([^/]+)\/json$/);
      const c = m && containers.get(decodeURIComponent(m[1]));
      res.writeHead(c ? 200 : 404, { "Content-Type": "application/json" });
      res.end(JSON.stringify(c ? { Id: c.Id, Config: { Labels: c.Labels } } : { message: "no" }));
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  process.env.DOCKER_PROXY_URL = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  if (root) rmSync(root, { recursive: true, force: true });
  delete process.env.SUITE_DATA_DIR;
});

beforeEach(() => {
  freshDatabase();
  containers = new Map();
  // A real directory, because validatePath deliberately refuses a path the
  // Suite cannot see — the whole point of it is to fail here rather than at
  // container-start time. Comes from the environment, same as it would from
  // compose's SUITE_DATA_DIR.
  root = mkdtempSync(path.join(tmpdir(), "suite-stack-"));
  process.env.SUITE_DATA_DIR = root;
});

const PROVIDER = {
  displayName: "Provider 1",
  xtreamBaseUrl: "http://provider.example:8080",
  xtreamUser: "u",
  xtreamPassword: "p",
  authMode: "basic",
  authUser: "viewer",
  authPassword: "secret",
};

function configureStack() {
  saveComponentValues("gluetun", {
    networks: "ssbackend",
    vpnServiceProvider: "nordvpn",
    vpnType: "wireguard",
    wireguardPrivateKey: "k",
  });
  saveComponentValues("postgres", {
    mode: "external",
    host: "db.example",
    port: "5432",
    adminUser: "postgres",
    adminPassword: "x",
  });
}

const vpn = (on) => setSetting(VPN_ENABLED_SETTING, on ? "true" : "false");

// --- allocation -------------------------------------------------------------

test("the first instance gets the bottom of the band", () => {
  assert.equal(allocatePort(), portBand().first);
});

test("the port band defaults to 8080-8099, 20 slots wide", () => {
  assert.deepEqual(portBand(), { first: 8080, last: 8099 });
});

test("moving the band's start moves where the next port is allocated from", () => {
  setSetting(PORT_BAND_START_SETTING, 9000);
  assert.deepEqual(portBand(), { first: 9000, last: 9019 });
  assert.equal(allocatePort(), 9000);
});

test("moving the band does not renumber an instance that already has a port", () => {
  const { key, port } = provisionInstance(PROVIDER);
  assert.equal(port, 8080);

  setSetting(PORT_BAND_START_SETTING, 9000);
  assert.equal(Number(getComponentValues("instance", key).port), 8080);
  assert.equal(allocatePort(), 9000, "the next allocation still comes from the new band");
});

test("allocation skips ports already taken and is sticky across additions", () => {
  const first = provisionInstance(PROVIDER);
  const second = provisionInstance({ ...PROVIDER, displayName: "Provider 2" });
  const third = provisionInstance({ ...PROVIDER, displayName: "Provider 3" });

  assert.equal(first.port, 8080);
  assert.equal(second.port, 8081);
  assert.equal(third.port, 8082);

  // Adding the third must not have renumbered the first two — a renumber
  // recreates healthy containers to change nothing.
  assert.equal(getComponentValues("instance", first.key).port, "8080");
  assert.equal(getComponentValues("instance", second.key).port, "8081");
});

test("an instance keeps its port when another is removed from the middle", () => {
  provisionInstance(PROVIDER);
  const second = provisionInstance({ ...PROVIDER, displayName: "Provider 2" });
  const third = provisionInstance({ ...PROVIDER, displayName: "Provider 3" });

  assert.equal(getComponentValues("instance", third.key).port, "8082");
  assert.equal(getComponentValues("instance", second.key).port, "8081");
});

test("keys are unique and derived from the display name", () => {
  const a = provisionInstance(PROVIDER);
  const b = provisionInstance(PROVIDER);
  assert.equal(a.key, "provider-1");
  assert.equal(b.key, "provider-1-2");
});

test("provisioning generates the port, API key and database credentials", () => {
  const { key } = provisionInstance(PROVIDER);
  const values = getComponentValues("instance", key);

  assert.ok(values.port, "a port is allocated");
  assert.ok(values._apiKey, "an API key is generated so nobody has to type one");
  assert.equal(values._dbName, databaseNamesFor(key).database);
  assert.equal(values._dbUser, databaseNamesFor(key).user);
  assert.ok(values._dbPassword && values._dbPassword.length >= 20);
});

// --- the two topologies -----------------------------------------------------

test("with the VPN on, an instance joins gluetun's namespace and publishes nothing", async () => {
  configureStack();
  vpn(true);
  const { key } = provisionInstance(PROVIDER);

  const spec = await renderInstanceSpec(getComponentValues("instance", key), key);

  assert.equal(spec.networkMode, "container:streamshare-suite-gluetun");
  assert.equal(spec.ports, undefined, "Docker rejects a published port inside another's namespace");
  assert.equal(spec.networks, undefined);
});

test("with the VPN off, an instance sits on a network and publishes its own port", async () => {
  configureStack();
  vpn(false);
  const { key } = provisionInstance(PROVIDER);

  const spec = await renderInstanceSpec(getComponentValues("instance", key), key);

  assert.equal(spec.networkMode, undefined);
  assert.deepEqual(spec.ports, [{ host: 8080, container: 8080, protocol: "tcp" }]);
});

test("gluetun publishes every instance's port on their behalf", async () => {
  configureStack();
  vpn(true);
  provisionInstance(PROVIDER);
  provisionInstance({ ...PROVIDER, displayName: "Provider 2" });

  const spec = await renderGluetunSpec(getComponentValues("gluetun"));

  assert.deepEqual(spec.ports, [
    { host: 8080, container: 8080, protocol: "tcp" },
    { host: 8081, container: 8081, protocol: "tcp" },
  ]);
});

test("the computed URL follows the VPN toggle without anyone editing it", () => {
  configureStack();
  const { key } = provisionInstance(PROVIDER);
  const values = getComponentValues("instance", key);

  vpn(true);
  assert.equal(instanceUrl(key, values), "http://streamshare-suite-gluetun:8080");

  vpn(false);
  assert.equal(instanceUrl(key, values), "http://streamshare-suite-provider-1:8080");
});

test("a managed instance reaches the ops layer already addressed and authenticated", () => {
  configureStack();
  const { key } = provisionInstance(PROVIDER);

  const instance = loadConfig().instances.find((i) => i.id === key);

  assert.ok(instance, "a created instance appears on the dashboard without being added twice");
  assert.equal(instance.name, "Provider 1");
  assert.equal(instance.url, "http://streamshare-suite-gluetun:8080");
  assert.equal(instance.apiKey, getComponentValues("instance", key)._apiKey);
});

test("an overridden container name is what the spec and the URL both use", async () => {
  configureStack();
  vpn(false);
  const { key } = provisionInstance({ ...PROVIDER, containerName: "my-existing-instance" });
  const values = getComponentValues("instance", key);

  assert.equal(instanceContainerName(key, values), "my-existing-instance");
  assert.equal(instanceUrl(key, values), "http://my-existing-instance:8080");
  assert.equal((await renderInstanceSpec(values, key)).name, "my-existing-instance");
});

test("an instance with no caching enabled gets no cache volume at all", async () => {
  configureStack();
  vpn(false);
  const { key } = provisionInstance(PROVIDER);

  const spec = await renderInstanceSpec(getComponentValues("instance", key), key);

  assert.equal(spec.volumes.some((v) => v.endsWith(":/cache")), false);
  assert.equal(spec.volumes.some((v) => v.endsWith(":/root")), true, "the config mount is still there");
});

test("an instance with VOD caching on gets a cache volume from its own cachePath", async () => {
  configureStack();
  vpn(false);
  const cacheDir = mkdtempSync(path.join(tmpdir(), "suite-instance-cache-"));
  const { key } = provisionInstance({ ...PROVIDER, vodCacheEnabled: "true", cachePath: cacheDir });

  const spec = await renderInstanceSpec(getComponentValues("instance", key), key);

  assert.ok(spec.volumes.includes(`${cacheDir}:/cache`));
  rmSync(cacheDir, { recursive: true, force: true });
});

test("Discord on computes DISCORD_API_URL from publicBaseUrl rather than asking for it twice", async () => {
  configureStack();
  vpn(false);
  const { key } = provisionInstance({
    ...PROVIDER,
    publicBaseUrl: "https://tv.example.com/provider-1",
    discordEnabled: true,
    discordBotToken: "tok",
  });

  const spec = await renderInstanceSpec(getComponentValues("instance", key), key);

  assert.equal(spec.env.DISCORD_API_URL, "https://tv.example.com/provider-1");
  assert.equal(spec.env.DISCORD_BOT_TOKEN, "tok");
});

test("Discord off means no DISCORD_API_URL, even with a public base URL set", async () => {
  configureStack();
  vpn(false);
  const { key } = provisionInstance({ ...PROVIDER, publicBaseUrl: "https://tv.example.com/provider-1" });

  const spec = await renderInstanceSpec(getComponentValues("instance", key), key);

  assert.equal("DISCORD_API_URL" in spec.env, false);
});

// --- the cascade, for real --------------------------------------------------

test("recreating gluetun cascades to every instance inside its namespace", async () => {
  configureStack();
  vpn(true);
  const a = provisionInstance(PROVIDER);
  const b = provisionInstance({ ...PROVIDER, displayName: "Provider 2" });

  // Everything deployed and matching, except gluetun, whose configuration has
  // moved on — exactly the shape of changing a VPN setting.
  const settled = await planStack();
  for (const plan of settled.plans) {
    if (!plan.spec) continue;
    containers.set(plan.spec.name, {
      Id: `id-${plan.spec.name}`,
      name: plan.spec.name,
      Labels: managedLabels(plan.kind, plan.desiredHash, plan.key),
    });
  }
  containers.get("streamshare-suite-gluetun").Labels = managedLabels("gluetun", "stale", "");

  const { plans, summary } = await planStack();
  const row = (id) => plans.find((p) => p.id === id);

  assert.equal(row("gluetun").action, "recreate");
  assert.equal(row("gluetun").cascadedFrom, null, "gluetun changed on its own merits");

  for (const key of [a.key, b.key]) {
    const instance = row(`instance:${key}`);
    assert.equal(instance.action, "recreate", `${key} cannot survive gluetun being replaced`);
    assert.equal(instance.cascadedFrom, "gluetun");
  }

  assert.equal(summary.cascaded, 2);
  assert.equal(summary.restarts, 3);
});

test("with the VPN off, gluetun is gone and nothing cascades", async () => {
  configureStack();
  vpn(false);
  const { key } = provisionInstance(PROVIDER);

  const { plans } = await planStack();
  const instance = plans.find((p) => p.id === `instance:${key}`);

  assert.equal(instance.namespaceHost, null);
  assert.equal(instance.cascadedFrom, null);
});

test("gluetun is planned before the instances that live inside it", async () => {
  configureStack();
  vpn(true);
  provisionInstance(PROVIDER);

  const { plans } = await planStack();
  const ids = plans.map((p) => p.id);

  assert.ok(ids.indexOf("gluetun") < ids.indexOf("instance:provider-1"));
});

test("an instance with no usable stack paths is incomplete rather than mis-mounted", async () => {
  configureStack();
  delete process.env.SUITE_DATA_DIR;
  provisionInstance(PROVIDER);

  const { plans } = await planStack();
  const instance = plans.find((p) => p.kind === "instance");

  assert.equal(instance.action, "incomplete");
  assert.match(instance.reason, /data path/i);
});

test("an instance caching with a cache path the Suite can't see still plans fine — the Suite never checks it", async () => {
  configureStack();
  const { key } = provisionInstance({ ...PROVIDER, vodCacheEnabled: "true", cachePath: "/definitely/not/mounted" });

  const { plans } = await planStack();
  const instance = plans.find((p) => p.kind === "instance");

  assert.notEqual(instance.action, "incomplete");
});

test("an instance not caching anything plans fine regardless of cachePath", async () => {
  configureStack();
  const { key } = provisionInstance(PROVIDER);

  const { plans } = await planStack();
  const instance = plans.find((p) => p.kind === "instance");

  assert.notEqual(instance.action, "incomplete");
});

test("instanceKeyFor does not collide with an externally configured instance", async () => {
  const { createInstance } = await import("../src/store/instances.js");
  createInstance({ name: "Provider 1", url: "http://elsewhere:8080" });

  assert.notEqual(instanceKeyFor("Provider 1"), "provider-1");
});

test("an instance whose database component is incomplete is blocked, naming it", async () => {
  // A managed postgres with nothing filled in. Without dependency propagation
  // the instance plans a create and then fails mid-apply against a host that
  // was never built — which is exactly what the smoke test hit.
  saveComponentValues("gluetun", {
    networks: "ssbackend",
    vpnServiceProvider: "nordvpn",
    vpnType: "wireguard",
    wireguardPrivateKey: "k",
  });
  saveComponentValues("postgres", { mode: "managed" });
  provisionInstance(PROVIDER);

  const { plans, summary } = await planStack();
  const instance = plans.find((p) => p.kind === "instance");

  assert.equal(instance.action, "incomplete");
  assert.match(instance.reason, /PostgreSQL must be configured first/i);

  // gluetun depends on nothing, so it is still creatable — blocking one
  // component must not stall the independent parts of the stack. What matters
  // is that the instance itself is not counted as applicable.
  assert.equal(summary.incomplete, 2, "postgres and the instance that needs it");
  assert.equal(
    plans.filter((p) => p.kind === "instance" && p.action !== "incomplete").length,
    0
  );
});

test("an instance with no database configured at all is blocked before it can fail on connect", async () => {
  saveComponentValues("gluetun", {
    networks: "ssbackend",
    vpnServiceProvider: "nordvpn",
    vpnType: "wireguard",
    wireguardPrivateKey: "k",
  });
  // External mode with no host: contributes no node, so the dependency check
  // cannot see it — the readiness check is what catches this one.
  saveComponentValues("postgres", { mode: "external", adminUser: "postgres", adminPassword: "x" });
  provisionInstance(PROVIDER);

  const { plans } = await planStack();
  const instance = plans.find((p) => p.kind === "instance");

  assert.equal(instance.action, "incomplete");
  assert.match(instance.reason, /No PostgreSQL server is configured/i);
});

// --- Discord fields ----------------------------------------------------

test("discordBotToken is required only once discordEnabled is on", () => {
  const base = { ...PROVIDER, publicBaseUrl: "https://tv.example.com/p1" };
  assert.equal(validate(INSTANCE_SCHEMA, base).some((e) => e.key === "discordBotToken"), false);
  assert.equal(
    validate(INSTANCE_SCHEMA, { ...base, discordEnabled: true }).some((e) => e.key === "discordBotToken"),
    true
  );
  assert.equal(
    validate(INSTANCE_SCHEMA, { ...base, discordEnabled: true, discordBotToken: "tok" }).some(
      (e) => e.key === "discordBotToken"
    ),
    false
  );
});

test("publicBaseUrl becomes required once discordEnabled is on, optional otherwise", () => {
  assert.equal(validate(INSTANCE_SCHEMA, PROVIDER).some((e) => e.key === "publicBaseUrl"), false);
  assert.equal(
    validate(INSTANCE_SCHEMA, { ...PROVIDER, discordEnabled: true, discordBotToken: "tok" }).some(
      (e) => e.key === "publicBaseUrl"
    ),
    true
  );
});

test("renderEnv only emits DISCORD_BOT_TOKEN/DISCORD_ADMIN_ROLE_ID when discordEnabled is on", () => {
  const off = renderEnv(INSTANCE_SCHEMA, PROVIDER);
  assert.equal("DISCORD_BOT_TOKEN" in off, false);
  assert.equal("DISCORD_ADMIN_ROLE_ID" in off, false);

  const on = renderEnv(INSTANCE_SCHEMA, {
    ...PROVIDER,
    discordEnabled: true,
    discordBotToken: "tok",
    discordAdminRoleId: "role-1",
  });
  assert.equal(on.DISCORD_BOT_TOKEN, "tok");
  assert.equal(on.DISCORD_ADMIN_ROLE_ID, "role-1");
});

test("renderEnv omits DISCORD_ADMIN_ROLE_ID when left blank, even with Discord on", () => {
  const env = renderEnv(INSTANCE_SCHEMA, { ...PROVIDER, discordEnabled: true, discordBotToken: "tok" });
  assert.equal("DISCORD_ADMIN_ROLE_ID" in env, false);
});

// --- cache path ----------------------------------------------------------

test("vodCacheEnabled now defaults to off", () => {
  const fields = INSTANCE_SCHEMA.fields;
  assert.equal(fields.find((f) => f.key === "vodCacheEnabled").default, "false");
});

test("cachePath is not required while both caching flags are off", () => {
  assert.equal(validate(INSTANCE_SCHEMA, PROVIDER).some((e) => e.key === "cachePath"), false);
});

test("cachePath is required once VOD caching is on", () => {
  const errors = validate(INSTANCE_SCHEMA, { ...PROVIDER, vodCacheEnabled: "true" });
  assert.equal(errors.some((e) => e.key === "cachePath"), true);
});

test("cachePath is required once catchup is on, independently of VOD caching", () => {
  const errors = validate(INSTANCE_SCHEMA, { ...PROVIDER, catchupEnabled: "true" });
  assert.equal(errors.some((e) => e.key === "cachePath"), true);
});

test("cachePath satisfied with either caching flag on and a value given", () => {
  const errors = validate(INSTANCE_SCHEMA, {
    ...PROVIDER,
    vodCacheEnabled: "true",
    cachePath: "/mnt/cache/provider-1",
  });
  assert.equal(errors.some((e) => e.key === "cachePath"), false);
});

// --- provider type ---------------------------------------------------------

test("providerType defaults to xtream, matching every existing instance's stored config", () => {
  const fields = INSTANCE_SCHEMA.fields;
  assert.equal(fields.find((f) => f.key === "providerType").default, "xtream");
});

test("xtream fields are required by default (providerType unset, same as every existing instance)", () => {
  const errors = validate(INSTANCE_SCHEMA, { displayName: "Provider 1" });
  const keys = errors.map((e) => e.key);
  assert.ok(keys.includes("xtreamBaseUrl"));
  assert.ok(keys.includes("xtreamUser"));
  assert.ok(keys.includes("xtreamPassword"));
});

test("xtream fields are hidden and not required once providerType is m3u", () => {
  const errors = validate(INSTANCE_SCHEMA, {
    displayName: "Provider 1",
    providerType: "m3u",
    m3uUrl: "http://provider.example/get.php?username=u&password=p&type=m3u_plus&output=m3u8",
  });
  const keys = errors.map((e) => e.key);
  assert.equal(keys.includes("xtreamBaseUrl"), false);
  assert.equal(keys.includes("xtreamUser"), false);
  assert.equal(keys.includes("xtreamPassword"), false);
});

test("m3uUrl is not required while providerType is xtream", () => {
  assert.equal(validate(INSTANCE_SCHEMA, PROVIDER).some((e) => e.key === "m3uUrl"), false);
});

test("m3uUrl becomes required once providerType is m3u", () => {
  const errors = validate(INSTANCE_SCHEMA, { displayName: "Provider 1", providerType: "m3u" });
  assert.equal(errors.some((e) => e.key === "m3uUrl"), true);

  const withUrl = validate(INSTANCE_SCHEMA, {
    displayName: "Provider 1",
    providerType: "m3u",
    m3uUrl: "http://provider.example/playlist.m3u",
  });
  assert.equal(withUrl.some((e) => e.key === "m3uUrl"), false);
});

test("m3uUrl stays visible (in toPublicFields) even in xtream mode, unlike a dependsOn-hidden field", () => {
  const fields = toPublicFields(INSTANCE_SCHEMA, PROVIDER);
  assert.ok(fields.some((f) => f.key === "m3uUrl"));
});

test("renderEnv emits XTREAM_* and omits M3U_URL for a default (xtream) instance", () => {
  const env = renderEnv(INSTANCE_SCHEMA, PROVIDER);
  assert.equal(env.XTREAM_BASE_URL, PROVIDER.xtreamBaseUrl);
  assert.equal(env.XTREAM_USER, PROVIDER.xtreamUser);
  assert.equal(env.XTREAM_PASSWORD, PROVIDER.xtreamPassword);
  assert.equal("M3U_URL" in env, false);
});

test("renderEnv emits M3U_URL and omits XTREAM_* for an m3u instance", () => {
  const env = renderEnv(INSTANCE_SCHEMA, {
    displayName: "Provider 1",
    providerType: "m3u",
    m3uUrl: "http://provider.example/playlist.m3u",
    authMode: "basic",
    authUser: "viewer",
    authPassword: "secret",
  });
  assert.equal(env.M3U_URL, "http://provider.example/playlist.m3u");
  assert.equal("XTREAM_BASE_URL" in env, false);
  assert.equal("XTREAM_USER" in env, false);
  assert.equal("XTREAM_PASSWORD" in env, false);
});

test("renderEnv still omits XTREAM_* for a stale value once providerType switches to m3u", () => {
  // Same "no leftover env from a mode you switched away from" guarantee
  // dependsOn already gives every other conditional field in this schema.
  const env = renderEnv(INSTANCE_SCHEMA, {
    ...PROVIDER,
    providerType: "m3u",
    m3uUrl: "http://provider.example/playlist.m3u",
  });
  assert.equal("XTREAM_BASE_URL" in env, false);
});
