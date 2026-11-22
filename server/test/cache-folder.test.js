// The helper that hands a brand-new custom cache folder to PUID:PGID before an
// instance starts. Proven against a fake Docker daemon that records the
// create/start/wait/remove calls. Ownership is injected so the tests hold when
// the suite itself runs as root.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { prepareCacheFolder } from "../src/reconcile/cacheFolder.js";
import { instanceContainerName } from "../src/reconcile/instance.js";
import { freshDatabase } from "./helpers.js";

let server;
let containers; // name -> labels
let requests;
let nextExit;
let waitStatus;

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      requests.push({ method: req.method, path: url.pathname, query: url.searchParams, body: raw ? JSON.parse(raw) : null });
      const json = (status, obj) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(obj));

      if (req.method === "POST" && url.pathname === "/v1.43/containers/create") {
        const name = url.searchParams.get("name");
        if (containers.has(name)) return json(409, { message: "conflict" });
        containers.set(name, (raw && JSON.parse(raw).Labels) || {});
        return json(201, { Id: "h1" });
      }
      const inspect = url.pathname.match(/^\/v1\.43\/containers\/([^/]+)\/json$/);
      if (req.method === "GET" && inspect) {
        const name = decodeURIComponent(inspect[1]);
        return containers.has(name) ? json(200, { Config: { Labels: containers.get(name) } }) : json(404, { message: "no" });
      }
      if (req.method === "POST" && url.pathname.endsWith("/start")) return res.writeHead(204).end();
      if (req.method === "POST" && url.pathname.endsWith("/wait")) {
        return waitStatus === 200 ? json(200, { StatusCode: nextExit }) : json(waitStatus, { message: "boom" });
      }
      if (req.method === "DELETE") {
        containers.clear();
        return res.writeHead(204).end();
      }
      json(500, { message: `unhandled ${req.method} ${url.pathname}` });
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  process.env.DOCKER_PROXY_URL = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

let lines;
const log = (line) => lines.push(line);
const own = { uid: 99, gid: 100 };

beforeEach(() => {
  freshDatabase();
  containers = new Map();
  requests = [];
  lines = [];
  nextExit = 0;
  waitStatus = 200;
});

const values = (extra = {}) => ({ displayName: "Provider 1", vodCacheEnabled: "true", ...extra });
const create = () => requests.find((r) => r.method === "POST" && r.path.endsWith("/containers/create"));

test("creates the helper as root with the cache path bound and our ids in the script", async () => {
  nextExit = 10;
  const v = values({ cachePath: "/mnt/cache dir/x" });
  await prepareCacheFolder("cache-test", v, { log, ownership: own });
  assert.equal(create().query.get("name"), `${instanceContainerName("cache-test", v)}-cache-init`);
  assert.equal(create().body.User, "0:0");
  assert.deepEqual(create().body.HostConfig.Binds, ["/mnt/cache dir/x:/cache"]);
  assert.equal(create().body.HostConfig.Mounts, undefined);
  assert.equal(create().body.HostConfig.NetworkMode, "none");
  assert.deepEqual(create().body.Entrypoint, ["sh", "-c"]);
  assert.match(create().body.Cmd[0], /chown 99:100 \/cache/);
  assert.ok(!create().body.Cmd[0].includes("/mnt/cache dir/x"));
  assert.deepEqual(lines, ["Gave the new cache folder /mnt/cache dir/x to 99:100."]);
  assert.equal(requests.at(-1).method, "DELETE");
});

test("an existing folder (exit 0) is left alone silently", async () => {
  await prepareCacheFolder("cache-test", values({ cachePath: "/mnt/c" }), { log, ownership: own });
  assert.deepEqual(lines, []);
  assert.ok(requests.some((r) => r.method === "DELETE"));
});

test("a failing helper logs a warning and does not throw", async () => {
  nextExit = 1;
  await prepareCacheFolder("cache-test", values({ cachePath: "/mnt/c" }), { log, ownership: own });
  assert.equal(lines.length, 1);
  assert.ok(lines[0].startsWith("Warning: could not prepare the cache folder /mnt/c: "));
  assert.match(lines[0], /exited with code 1/);
});

test("a failed wait still removes the helper and only warns", async () => {
  waitStatus = 500;
  await prepareCacheFolder("cache-test", values({ cachePath: "/mnt/c" }), { log, ownership: own });
  assert.equal(lines.length, 1);
  assert.ok(lines[0].startsWith("Warning: could not prepare the cache folder /mnt/c: "));
  assert.equal(requests.at(-1).method, "DELETE");
});

test("a leftover helper from an earlier apply is removed first", async () => {
  containers.set(`${instanceContainerName("cache-test", values())}-cache-init`, { "streamshare.suite.cache-init": "true" });
  nextExit = 10;
  await prepareCacheFolder("cache-test", values({ cachePath: "/mnt/c" }), { log, ownership: own });
  const del = requests.findIndex((r) => r.method === "DELETE");
  const cre = requests.findIndex((r) => r.path.endsWith("/containers/create"));
  assert.ok(del >= 0 && del < cre);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].startsWith("Gave"));
});

test("a foreign container of the helper's name is left alone and only warned about", async () => {
  containers.set(`${instanceContainerName("cache-test", values())}-cache-init`, {});
  await prepareCacheFolder("cache-test", values({ cachePath: "/mnt/c" }), { log, ownership: own });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Warning: could not prepare the cache folder \/mnt\/c: .*not a cache helper/);
  assert.ok(!requests.some((r) => r.method === "DELETE" || r.path.endsWith("/containers/create")));
});

test("blank cache path or caching off runs no helper", async () => {
  await prepareCacheFolder("cache-test", values({ cachePath: "  " }), { log, ownership: own });
  await prepareCacheFolder("cache-test", { displayName: "P", cachePath: "/mnt/c" }, { log, ownership: own });
  assert.equal(requests.length, 0);
});

test("running as root or without ids runs no helper", async () => {
  for (const ownership of [{ uid: 0, gid: 0 }, null]) {
    await prepareCacheFolder("cache-test", values({ cachePath: "/mnt/c" }), { log, ownership });
  }
  assert.equal(requests.length, 0);
});
