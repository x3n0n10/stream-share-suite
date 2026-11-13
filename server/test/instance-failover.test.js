// Failover: the fallback list, the two derived environment variables, and
// which instances report support for it.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { failoverKey, peerUrl, failoverEnv } from "../src/reconcile/failover.js";
import { renderInstanceSpec, instanceContainerName } from "../src/reconcile/instance.js";
import { VPN_ENABLED_SETTING } from "../src/reconcile/catalog.js";
import { setSetting } from "../src/store/settings.js";
import { saveComponentValues, getComponentValues, listComponents } from "../src/store/components.js";
import { INSTANCE_SCHEMA } from "../src/schema/instance.js";
import { validate } from "../src/schema/registry.js";
import { createApp } from "../src/app.js";
import { _resetLoginThrottle } from "../src/auth/middleware.js";
import { freshDatabase, signedInClient } from "./helpers.js";

let root;
const realFetch = globalThis.fetch;

beforeEach(() => {
  freshDatabase();
  _resetLoginThrottle();
  root = mkdtempSync(path.join(tmpdir(), "suite-failover-"));
  process.env.SUITE_DATA_DIR = root;
  setSetting(VPN_ENABLED_SETTING, "false");
  saveComponentValues("postgres", { mode: "external", host: "db.example", port: "5432", adminUser: "postgres", adminPassword: "x" });
});

after(() => {
  globalThis.fetch = realFetch;
  if (root) rmSync(root, { recursive: true, force: true });
  delete process.env.SUITE_DATA_DIR;
});

function add(key, port, extra = {}) {
  saveComponentValues("instance", { displayName: key.toUpperCase(), port: String(port), _apiKey: `test-key-${key}`, ...extra }, key);
}

const rows = () => listComponents("instance");
const envOf = (key) => failoverEnv(key, getComponentValues("instance", key), rows());

test("failoverKey is a stable 64-char hex digest, not the key itself", () => {
  const k = failoverKey("abc");
  assert.match(k, /^[0-9a-f]{64}$/);
  assert.equal(k, failoverKey("abc"));
  assert.notEqual(k, "abc");
});

test("the fallbacks field is accepted on save and never rendered by the generic path", () => {
  assert.deepEqual(validate(INSTANCE_SCHEMA, { displayName: "A", xtreamBaseUrl: "http://p.example", xtreamUser: "u", xtreamPassword: "p", fallbacks: "b,ghost" }).filter((e) => e.key === "fallbacks"), []);
});

test("lists peers in order for the instance, and only peers get the lending key", () => {
  add("a", 8081, { fallbacks: "b,c" });
  add("b", 8082);
  add("c", 8083);

  const a = envOf("a");
  assert.deepEqual(JSON.parse(a.FAILOVER_INSTANCES), [
    { name: "B", url: `http://${instanceContainerName("b", {})}:8082`, key: failoverKey("test-key-b") },
    { name: "C", url: `http://${instanceContainerName("c", {})}:8083`, key: failoverKey("test-key-c") },
  ]);
  assert.equal(a.FAILOVER_KEY, undefined);

  for (const k of ["b", "c"]) {
    const env = envOf(k);
    assert.equal(env.FAILOVER_KEY, failoverKey(`test-key-${k}`));
    assert.equal(env.FAILOVER_INSTANCES, undefined);
  }
});

test("ghost, self and repeated keys are skipped", () => {
  add("a", 8081, { fallbacks: "a,ghost,b,b" });
  add("b", 8082);
  assert.deepEqual(JSON.parse(envOf("a").FAILOVER_INSTANCES).map((p) => p.name), ["B"]);
});

test("a peer without an API key is skipped, and an empty result omits the variable", () => {
  add("a", 8081, { fallbacks: "b" });
  add("b", 8082, { _apiKey: "" });
  assert.deepEqual(envOf("a"), {});
});

test("with no fallbacks anywhere the rendered spec is unchanged", async () => {
  add("a", 8081);
  add("b", 8082);
  const values = getComponentValues("instance", "a");
  const { fallbacks, ...without } = values;
  const spec = await renderInstanceSpec(values, "a");
  assert.equal("FAILOVER_INSTANCES" in spec.env || "FAILOVER_KEY" in spec.env, false);
  assert.deepEqual(spec, await renderInstanceSpec(without, "a"));
});

test("renderInstanceSpec carries the derived variables", async () => {
  add("a", 8081, { fallbacks: "b" });
  add("b", 8082);
  const specA = await renderInstanceSpec(getComponentValues("instance", "a"), "a");
  const specB = await renderInstanceSpec(getComponentValues("instance", "b"), "b");
  assert.ok(specA.env.FAILOVER_INSTANCES);
  assert.equal(specB.env.FAILOVER_KEY, failoverKey("test-key-b"));
});

test("peer address: loopback with the VPN on, container name with it off", () => {
  add("b", 8082);
  const values = getComponentValues("instance", "b");
  assert.equal(peerUrl("b", values), `http://${instanceContainerName("b", values)}:8082`);
  setSetting(VPN_ENABLED_SETTING, "true");
  assert.equal(peerUrl("b", values), "http://127.0.0.1:8082");
});

test("GET /failover-support lists only instances that answer failover: true", async () => {
  add("a", 8081);
  add("b", 8082);
  add("c", 8083);
  const server = createApp({ serveStatic: false }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const c = await signedInClient(base);
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u.startsWith(base)) return realFetch(url, init);
      if (u.includes(":8081/")) return Response.json({ data: { version: "1.0.0", failover: true } });
      if (u.includes(":8082/")) return Response.json({ data: { version: "1.0.0" } });
      throw new Error("unreachable");
    };
    const { status, body } = await c.get("/api/stack/failover-support");
    assert.equal(status, 200);
    assert.deepEqual(body, { supported: ["a"] });
  } finally {
    globalThis.fetch = realFetch;
    server.close();
  }
});
