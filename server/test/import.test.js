// Import-from-running-containers: classifying candidates by image, and
// reading a real container's own env/image/networks back into the Suite's
// stored configuration for it — against a fake Docker daemon so the whole
// chain (list -> inspect -> reverse-map -> store) is proven together, not
// just the pure mapping logic.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { listImportCandidates, importCandidate } from "../src/reconcile/import.js";
import { getComponentValues, saveComponentValues, listComponents } from "../src/store/components.js";
import { provisionInstance } from "../src/reconcile/provisioning.js";
import { managedLabels } from "../src/docker/labels.js";
import { freshDatabase } from "./helpers.js";

let server;
let containers; // id -> full inspect-shaped record; also indexed by name for lookup

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    req.on("data", () => {});
    req.on("end", () => route(req.method, url, res));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  process.env.DOCKER_PROXY_URL = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

beforeEach(() => {
  freshDatabase();
  containers = new Map();
  process.env.SUITE_DATA_DIR = "";
  process.env.SUITE_CACHE_DIR = "";
});

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function route(method, url, res) {
  if (method === "GET" && url.pathname === "/v1.43/containers/json") {
    return json(
      res,
      200,
      [...containers.values()].map((c) => ({
        Id: c.Id,
        Names: [`/${c.name}`],
        Image: c.Config.Image,
        Labels: c.Config.Labels || {},
      }))
    );
  }

  const m = url.pathname.match(/^\/v1\.43\/containers\/([^/]+)\/json$/);
  if (method === "GET" && m) {
    const idOrName = decodeURIComponent(m[1]);
    const c = containers.get(idOrName) || [...containers.values()].find((v) => v.Id === idOrName);
    if (!c) return json(res, 404, { message: "No such container" });
    return json(res, 200, {
      Id: c.Id,
      Name: `/${c.name}`,
      Config: { Image: c.Config.Image, Env: c.Config.Env || [], Labels: c.Config.Labels || {} },
      NetworkSettings: { Networks: c.networks || {} },
    });
  }

  json(res, 500, { message: `unhandled ${method} ${url.pathname}` });
}

let nextId = 1;
function addContainer({ name, image, env = [], networks = {}, labels = {} }) {
  const id = `id-${nextId++}`;
  const record = { Id: id, name, Config: { Image: image, Env: env, Labels: labels }, networks };
  containers.set(name, record);
  containers.set(id, record);
  return record;
}

// --- classification ----------------------------------------------------------

test("classifies candidates by image, not by name", async () => {
  addContainer({ name: "vpn-box", image: "qmcgaw/gluetun:latest" });
  addContainer({ name: "db", image: "postgres:14-alpine" });
  addContainer({ name: "tv1", image: "ghcr.io/x3n0n10/stream-share:latest" });

  const candidates = await listImportCandidates();
  const byName = Object.fromEntries(candidates.map((c) => [c.name, c.kind]));
  assert.equal(byName["vpn-box"], "gluetun");
  assert.equal(byName["db"], "postgres");
  assert.equal(byName["tv1"], "instance");
});

test("classifies both the upstream image and a fork's -docker suffix as uhf", async () => {
  addContainer({ name: "uhf1", image: "swapplications/uhf-server:1.5.1" });
  addContainer({ name: "uhf2", image: "solidpixel/uhf-server-docker:latest" });

  const candidates = await listImportCandidates();
  const byName = Object.fromEntries(candidates.map((c) => [c.name, c.kind]));
  assert.equal(byName["uhf1"], "uhf");
  assert.equal(byName["uhf2"], "uhf");
});

test("never classifies the Suite's own images as an instance candidate", async () => {
  addContainer({ name: "suite", image: "ghcr.io/x3n0n10/stream-share-suite:latest" });
  addContainer({ name: "dashboard", image: "ghcr.io/x3n0n10/stream-share-dashboard:latest" });

  const candidates = await listImportCandidates();
  assert.equal(candidates.length, 0);
});

test("excludes a container already managed by the Suite", async () => {
  addContainer({
    name: "already-ours",
    image: "qmcgaw/gluetun:latest",
    labels: managedLabels("gluetun", "somehash"),
  });

  assert.equal((await listImportCandidates()).length, 0);
});

test("ignores a container whose image matches nothing the Suite manages", async () => {
  addContainer({ name: "unrelated", image: "nginx:latest" });
  assert.equal((await listImportCandidates()).length, 0);
});

// --- gluetun -------------------------------------------------------------

test("importing gluetun recovers its schema fields from its own env", async () => {
  const c = addContainer({
    name: "my-real-gluetun",
    image: "qmcgaw/gluetun:latest",
    env: ["VPN_SERVICE_PROVIDER=nordvpn", "VPN_TYPE=wireguard", "WIREGUARD_PRIVATE_KEY=secret-key"],
    networks: { ssbackend: {}, nordvpn: {} },
  });

  const result = await importCandidate(c.Id, "gluetun");
  assert.deepEqual(result, { kind: "gluetun", key: "" });

  const values = getComponentValues("gluetun");
  assert.equal(values.vpnServiceProvider, "nordvpn");
  assert.equal(values.vpnType, "wireguard");
  assert.equal(values.wireguardPrivateKey, "secret-key");
  assert.equal(values.networks, "ssbackend,nordvpn");
  assert.equal(values.image, "qmcgaw/gluetun:latest");
});

test("importing gluetun records a containerName override when its real name differs from the default", async () => {
  const c = addContainer({ name: "stream-share-gluetun", image: "qmcgaw/gluetun:latest", env: [] });
  await importCandidate(c.Id, "gluetun");
  assert.equal(getComponentValues("gluetun").containerName, "stream-share-gluetun");
});

test("importing gluetun folds unmodelled env into extraEnv but never the computed ones", async () => {
  const c = addContainer({
    name: "g",
    image: "qmcgaw/gluetun:latest",
    env: ["VPN_SERVICE_PROVIDER=nordvpn", "FREE_ONLY=on", "HTTP_CONTROL_SERVER_ADDRESS=:8000"],
  });
  await importCandidate(c.Id, "gluetun");

  const values = getComponentValues("gluetun");
  assert.match(values.extraEnv, /FREE_ONLY=on/);
  assert.doesNotMatch(values.extraEnv, /HTTP_CONTROL_SERVER_ADDRESS/);
  assert.doesNotMatch(values.extraEnv, /VPN_SERVICE_PROVIDER/, "modelled fields are not duplicated into extraEnv");
});

test("re-importing gluetun without overwrite is refused once it is already configured", async () => {
  const c = addContainer({ name: "g", image: "qmcgaw/gluetun:latest", env: ["VPN_SERVICE_PROVIDER=nordvpn"] });
  await importCandidate(c.Id, "gluetun");

  await assert.rejects(() => importCandidate(c.Id, "gluetun"), /already configured/);

  // With overwrite it goes through and actually replaces the stored values.
  const c2 = addContainer({ name: "g2", image: "qmcgaw/gluetun:latest", env: ["VPN_SERVICE_PROVIDER=mullvad"] });
  await importCandidate(c2.Id, "gluetun", { overwrite: true });
  assert.equal(getComponentValues("gluetun").vpnServiceProvider, "mullvad");
});

// --- postgres --------------------------------------------------------------

test("importing postgres recovers admin credentials and forces managed mode", async () => {
  const c = addContainer({
    name: "stream-share-db",
    image: "postgres:14-alpine",
    env: ["POSTGRES_USER=iptvproxy", "POSTGRES_PASSWORD=iptvproxypass"],
    networks: { ssbackend: {} },
  });

  await importCandidate(c.Id, "postgres");
  const values = getComponentValues("postgres");
  assert.equal(values.mode, "managed");
  assert.equal(values.adminUser, "iptvproxy");
  assert.equal(values.adminPassword, "iptvproxypass");
  assert.equal(values.containerName, "stream-share-db");
  assert.equal(values.networks, "ssbackend");
});

// --- uhf ---------------------------------------------------------------------

test("importing uhf recovers its schema fields and records a containerName override", async () => {
  const c = addContainer({
    name: "my-uhf",
    image: "solidpixel/uhf-server-docker:latest",
    env: ["PORT=9000", "PASSWORD=secret", "RECORDINGS_DIR=/recordings", "SOME_UNMODELLED=1"],
  });

  const result = await importCandidate(c.Id, "uhf");
  assert.deepEqual(result, { kind: "uhf", key: "" });

  const values = getComponentValues("uhf");
  assert.equal(values.port, "9000");
  assert.equal(values.password, "secret");
  assert.equal(values.containerName, "my-uhf");
  assert.equal(values.image, "solidpixel/uhf-server-docker:latest");
  assert.match(values.extraEnv, /SOME_UNMODELLED=1/);
  assert.doesNotMatch(values.extraEnv, /RECORDINGS_DIR/, "the renderer computes this itself");
});

test("re-importing uhf without overwrite is refused once it is already configured", async () => {
  const c = addContainer({ name: "u", image: "swapplications/uhf-server:latest", env: ["PORT=8000"] });
  await importCandidate(c.Id, "uhf");
  await assert.rejects(() => importCandidate(c.Id, "uhf"), /already configured/);
});

// --- instances ---------------------------------------------------------------

test("importing an instance recovers its provider and access fields, never regenerating its database credentials", async () => {
  const c = addContainer({
    name: "tv-provider-1",
    image: "ghcr.io/x3n0n10/stream-share:latest",
    env: [
      "INSTANCE_NAME=Provider 1",
      "XTREAM_BASE_URL=http://provider.example:8080",
      "XTREAM_USER=u",
      "XTREAM_PASSWORD=p",
      "AUTH_USER=viewer",
      "AUTH_PASSWORD=secret",
      "PORT=8080",
      "INTERNAL_API_KEY=real-api-key",
      "DB_NAME=streamshare_provider_1",
      "DB_USER=streamshare_provider_1",
      "DB_PASSWORD=real-db-password",
    ],
  });

  const { kind, key } = await importCandidate(c.Id, "instance");
  assert.equal(kind, "instance");

  const values = getComponentValues("instance", key);
  assert.equal(values.displayName, "Provider 1");
  assert.equal(values.xtreamBaseUrl, "http://provider.example:8080");
  assert.equal(values.authMode, "basic");
  assert.equal(values.authUser, "viewer");
  assert.equal(values.port, "8080");
  assert.equal(values.containerName, "tv-provider-1");
  assert.equal(values._apiKey, "real-api-key");
  assert.equal(values._dbName, "streamshare_provider_1");
  assert.equal(values._dbUser, "streamshare_provider_1");
  assert.equal(values._dbPassword, "real-db-password");
});

test("importing an instance infers LDAP auth mode from LDAP_ENABLED", async () => {
  const c = addContainer({
    name: "tv2",
    image: "ghcr.io/x3n0n10/stream-share:latest",
    env: ["INSTANCE_NAME=Provider 2", "LDAP_ENABLED=true", "LDAP_SERVER=ldap://ldap.example:389"],
  });
  const { key } = await importCandidate(c.Id, "instance");
  assert.equal(getComponentValues("instance", key).authMode, "ldap");
});

test("importing the same instance container twice is refused, rather than creating a duplicate", async () => {
  const c = addContainer({
    name: "tv3",
    image: "ghcr.io/x3n0n10/stream-share:latest",
    env: ["INSTANCE_NAME=Provider 3"],
  });
  await importCandidate(c.Id, "instance");
  await assert.rejects(() => importCandidate(c.Id, "instance"), /already imported/);
  assert.equal(listComponents("instance").length, 1);
});

test("importing an instance whose port clashes with one the Suite already knows about is refused", async () => {
  const existing = provisionInstance({
    displayName: "Existing",
    xtreamBaseUrl: "http://x",
    xtreamUser: "u",
    xtreamPassword: "p",
    authMode: "basic",
    authUser: "v",
    authPassword: "s",
  });

  const c = addContainer({
    name: "tv4",
    image: "ghcr.io/x3n0n10/stream-share:latest",
    env: ["INSTANCE_NAME=Provider 4", `PORT=${existing.port}`],
  });

  await assert.rejects(() => importCandidate(c.Id, "instance"), /already used/);
});

// --- shared guards -----------------------------------------------------------

test("importing a container already managed by the Suite is refused", async () => {
  const c = addContainer({
    name: "ours",
    image: "qmcgaw/gluetun:latest",
    labels: managedLabels("gluetun", "hash"),
  });
  await assert.rejects(() => importCandidate(c.Id, "gluetun"), /already managed/);
});

test("importing a container id that does not exist is refused", async () => {
  await assert.rejects(() => importCandidate("no-such-id", "gluetun"), /No container found/);
});
