// Update notices backend: version parsing, the GitHub client (stubbed fetch),
// the check run, the scheduler's due rule, the versions join and the setting.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { freshDatabase } from "./helpers.js";
import { parseVersion, isNewerRelease } from "../src/updates/compare.js";
import { createUpstream } from "../src/updates/upstream.js";
import { imageName, runUpdateCheck, withUpdates } from "../src/updates/check.js";
import { updateCheckStatus } from "../src/updates/check.js";
import { isCheckDue } from "../src/updates/scheduler.js";
import { createSettingsRouter } from "../src/routes/settings.js";

beforeEach(() => freshDatabase());

test("parseVersion: releases", () => {
  assert.deepEqual(parseVersion("1.4.2"), { type: "release", numbers: [1, 4, 2], hasV: false });
  assert.deepEqual(parseVersion("v3.40.0"), { type: "release", numbers: [3, 40, 0], hasV: true });
  assert.deepEqual(parseVersion("1.0.0-rc1"), { type: "release", numbers: [1, 0, 0], hasV: false });
});

test("parseVersion: commits", () => {
  assert.deepEqual(parseVersion("dev-a1b2c3d"), { type: "commit", sha: "a1b2c3d" });
  assert.deepEqual(parseVersion("a1b2c3d"), { type: "commit", sha: "a1b2c3d" });
  assert.deepEqual(parseVersion("v1.0.0-3-ga1b2c3d"), { type: "commit", sha: "a1b2c3d" });
});

test("parseVersion: rejects", () => {
  for (const v of ["dev", "2-alpine", "unknown", "latest", "", null]) assert.equal(parseVersion(v), null, String(v));
});

test("isNewerRelease", () => {
  assert.equal(isNewerRelease("1.0.0", "1.0.1"), true);
  assert.equal(isNewerRelease("1.0.1", "1.0.1"), false);
  assert.equal(isNewerRelease("1.2.0", "1.1.9"), false);
  assert.equal(isNewerRelease("1.9.0", "1.10.0"), true);
  assert.equal(isNewerRelease("v1.0.0", "1.0.1"), true);
  assert.equal(isNewerRelease("1.0.0", "v1.0.0"), false);
});

// A fetch stub answering from a { path: [status, body] } map; records calls.
function stubFetch(routes) {
  const calls = [];
  const fn = async (url, opts) => {
    const p = new URL(url).pathname;
    calls.push({ path: p, opts });
    const hit = routes[p];
    if (hit instanceof Error) throw hit;
    if (!hit) return { ok: false, status: 404, json: async () => ({}) };
    const [status, body] = hit;
    return { ok: status < 300, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

test("upstream: latest release, headers, no release", async () => {
  const f = stubFetch({ "/repos/a/b/releases/latest": [200, { tag_name: "v2.0.0" }] });
  const up = createUpstream({ fetch: f, userAgent: "ua/1" });
  assert.equal(await up.latestRelease("a/b"), "v2.0.0");
  assert.equal(f.calls[0].opts.headers["User-Agent"], "ua/1");
  assert.equal(f.calls[0].opts.headers["X-GitHub-Api-Version"], "2022-11-28");
  assert.equal(await up.latestRelease("a/none"), null);
});

test("upstream: commitsAhead ahead, behind and unknown", async () => {
  const f = stubFetch({
    "/repos/a/b/compare/aaaaaaa...main": [200, { ahead_by: 3 }],
    "/repos/a/b/compare/bbbbbbb...main": [200, { ahead_by: 0 }],
    "/repos/a/b/commits/main": [200, { sha: "1234567890abcdef" }],
  });
  const up = createUpstream({ fetch: f });
  assert.deepEqual(await up.commitsAhead("a/b", "aaaaaaa", "main"), { ahead: true, head: "1234567" });
  assert.equal((await up.commitsAhead("a/b", "bbbbbbb", "main")).ahead, false);
  assert.equal(await up.commitsAhead("a/b", "ccccccc", "main"), null);
  assert.equal(f.calls.filter((c) => c.path.endsWith("/commits/main")).length, 1, "head read once");
});

test("upstream: 403, 429, 5xx and thrown errors throw", async () => {
  for (const status of [403, 429, 500, 503]) {
    const up = createUpstream({ fetch: stubFetch({ "/repos/a/b/releases/latest": [status, {}] }) });
    await assert.rejects(up.latestRelease("a/b"), String(status));
  }
  const up = createUpstream({ fetch: stubFetch({ "/repos/a/b/releases/latest": new Error("net down") }) });
  await assert.rejects(up.latestRelease("a/b"), /net down/);
});

function memStore(initial = null) {
  let v = initial;
  return { get: () => v, set: (x) => (v = x) };
}

const NOW = new Date("2026-10-13T08:00:00.000Z");
// Rows carry the standard image of their kind unless a test overrides it.
const STD_IMAGE = {
  instance: "ghcr.io/x3n0n10/stream-share:latest",
  gluetun: "qmcgaw/gluetun:latest",
  caddy: "caddy:2.8.4",
};
const row = (kind, key, version, source = "self", status = "running", image = STD_IMAGE[kind]) => ({
  kind,
  key,
  label: key,
  status,
  version,
  source,
  image,
});

function fakeUpstream({ releases = {}, ahead = {}, fail = [] } = {}) {
  const asked = [];
  return {
    asked,
    async latestRelease(repo) {
      asked.push(repo);
      if (fail.includes(repo)) throw new Error("boom");
      return releases[repo] ?? null;
    },
    async commitsAhead(repo, sha) {
      asked.push(`${repo}@${sha}`);
      if (fail.includes(repo)) throw new Error("boom");
      return ahead[repo] ?? null;
    },
  };
}

test("runUpdateCheck: only eligible rows are queried, results stored", async () => {
  const versions = {
    suite: { version: "1.0.0" },
    components: [
      row("instance", "a", "dev-a1b2c3d"),
      row("instance", "stopped", "1.0.0", "self", "stopped"),
      row("instance", "nullv", null),
      row("instance", "img", "abcdef123456", "image-id"),
      row("gluetun", "", "v3.40.0"),
      row("postgres", "", "16.1.0", "self"),
      row("caddy", "", "2-alpine", "tag"),
    ],
  };
  const up = fakeUpstream({
    releases: { "x3n0n10/stream-share-suite": "1.0.1", "qdm12/gluetun": "v3.41.0" },
    ahead: { "x3n0n10/stream-share": { ahead: true, head: "9999999" } },
  });
  const store = memStore();
  const result = await runUpdateCheck({ versions, upstream: up, store, now: () => NOW });

  assert.deepEqual(up.asked.sort(), ["qdm12/gluetun", "x3n0n10/stream-share-suite", "x3n0n10/stream-share@a1b2c3d"].sort());
  assert.deepEqual(store.get(), result);
  assert.equal(result.suite, "1.0.1");
  assert.deepEqual(result.rows, { "instance:a": "9999999", "gluetun:": "v3.41.0" });
  assert.equal(result.checkedAt, NOW.toISOString());
});

test("runUpdateCheck: Caddy is checked only for a tagged release", async () => {
  const up = fakeUpstream({ releases: { "caddyserver/caddy": "v2.9.0" } });
  const r = await runUpdateCheck({
    versions: { suite: { version: "dev" }, components: [row("caddy", "", "2.8.4", "tag")] },
    upstream: up,
    store: memStore(),
    now: () => NOW,
  });
  assert.deepEqual(r.rows, { "caddy:": "2.9.0" });
});

test("runUpdateCheck: a failing row keeps its previous value, others continue, checkedAt not advanced", async () => {
  const old = {
    checkedAt: "2026-10-01T00:00:00.000Z",
    attemptedAt: "2026-10-01T00:00:00.000Z",
    rows: { "gluetun:": "v3.40.5", "instance:gone": "x" },
  };
  const store = memStore(old);
  const up = fakeUpstream({ fail: ["qdm12/gluetun"], releases: { "x3n0n10/stream-share-suite": "1.0.1" } });
  const r = await runUpdateCheck({
    versions: { suite: { version: "1.0.0" }, components: [row("gluetun", "", "v3.40.0")] },
    upstream: up,
    store,
    now: () => NOW,
  });
  assert.equal(r.suite, "1.0.1", "other checks still ran");
  assert.deepEqual(r.rows, { "gluetun:": "v3.40.5" }, "kept previous, dropped vanished row");
  assert.equal(r.checkedAt, old.checkedAt);
  assert.equal(r.attemptedAt, NOW.toISOString());
});

test("isCheckDue", () => {
  const now = Date.parse("2026-10-13T12:00:00Z");
  const ago = (h) => new Date(now - h * 3600_000).toISOString();
  assert.equal(isCheckDue({ enabled: false, result: null, now }), false);
  assert.equal(isCheckDue({ enabled: true, result: null, now }), true);
  assert.equal(isCheckDue({ enabled: true, result: { checkedAt: ago(23), attemptedAt: ago(23) }, now }), false);
  assert.equal(isCheckDue({ enabled: true, result: { checkedAt: ago(25), attemptedAt: ago(25) }, now }), true);
  assert.equal(isCheckDue({ enabled: true, result: { checkedAt: ago(30), attemptedAt: ago(0.5) }, now }), false);
  assert.equal(isCheckDue({ enabled: true, result: { checkedAt: ago(30), attemptedAt: ago(2) }, now }), true);
});

test("withUpdates: attaches latest, hides when off, drops a stale hint", () => {
  const versions = {
    suite: { version: "1.0.0" },
    components: [row("gluetun", "", "v3.40.0"), row("instance", "a", "1.5.0"), row("postgres", "", "16")],
  };
  const store = memStore({ suite: "1.0.1", rows: { "gluetun:": "v3.41.0", "instance:a": "1.4.3" } });

  const on = withUpdates(versions, { store, enabled: () => true });
  assert.equal(on.suite.latest, "1.0.1");
  assert.deepEqual(on.components.map((c) => c.latest), ["v3.41.0", null, null]);
  assert.equal(versions.suite.latest, undefined, "input not mutated");

  const off = withUpdates(versions, { store, enabled: () => false });
  assert.equal(off.suite.latest, null);
  assert.ok(off.components.every((c) => c.latest === null));
});

// The settings router mounted alone, so the kick hook can be observed.
async function withSettings(fn) {
  let kicks = 0;
  const app = express();
  app.use(express.json());
  app.use("/s", createSettingsRouter({ kick: () => kicks++ }));
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/s`;
  const get = () => fetch(base).then((r) => r.json());
  const put = (general) =>
    fetch(base, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ general }) });
  try {
    await fn({ get, put, kicks: () => kicks });
  } finally {
    server.close();
  }
}

test("settings: autoUpdateCheck defaults on, round-trips, kicks only on off to on", () =>
  withSettings(async ({ get, put, kicks }) => {
    assert.equal((await get()).general.autoUpdateCheck, true);
    assert.equal((await get()).general.updateCheckedAt, null, "never checked yet");

    await put({ autoUpdateCheck: true });
    assert.equal(kicks(), 0, "already on");

    await put({ autoUpdateCheck: false });
    assert.equal((await get()).general.autoUpdateCheck, false);
    assert.equal(kicks(), 0);

    await put({ title: "x" });
    assert.equal((await get()).general.autoUpdateCheck, false, "untouched when omitted");

    await put({ autoUpdateCheck: true });
    assert.equal((await get()).general.autoUpdateCheck, true);
    assert.equal(kicks(), 1);
  }));

test("updateCheckStatus: reports checkedAt and attemptedAt, null before any run", () => {
  assert.deepEqual(updateCheckStatus({ get: () => null }), { checkedAt: null, attemptedAt: null });
  assert.deepEqual(updateCheckStatus({ get: () => ({ checkedAt: "a", attemptedAt: "b", rows: {} }) }), {
    checkedAt: "a",
    attemptedAt: "b",
  });
});

test("imageName: strips tag, digest and Docker Hub prefixes, keeps registry ports", () => {
  assert.equal(imageName("qmcgaw/gluetun:v3.40.0"), "qmcgaw/gluetun");
  assert.equal(imageName("docker.io/qmcgaw/gluetun"), "qmcgaw/gluetun");
  assert.equal(imageName("docker.io/library/caddy:2.8.4"), "caddy");
  assert.equal(imageName("Caddy@sha256:abc"), "caddy");
  assert.equal(imageName("myregistry:5000/gluetun"), "myregistry:5000/gluetun");
  assert.equal(imageName(undefined), "");
});

test("runUpdateCheck: a custom image, or an unknown one, is never checked", async () => {
  const up = fakeUpstream({ releases: { "qdm12/gluetun": "v9.0.0", "caddyserver/caddy": "v9.0.0" } });
  const versions = {
    suite: { version: "dev" },
    components: [
      row("gluetun", "fork", "v3.40.0", "self", "running", "ghcr.io/someone/gluetun:latest"),
      row("gluetun", "none", "v3.40.0", "self", "running", null),
      row("instance", "mirror", "1.0.0", "self", "running", "registry.example/stream-share:latest"),
      row("caddy", "", "2.8.4", "tag", "running", "ghcr.io/someone/caddy-modular:2.8.4"),
    ],
  };
  const r = await runUpdateCheck({ versions, upstream: up, store: memStore(), now: () => NOW });
  assert.deepEqual(up.asked, []);
  assert.deepEqual(r.rows, {});
});

test("runUpdateCheck: the standard image counts under any tag or Docker Hub prefix", async () => {
  const up = fakeUpstream({ releases: { "qdm12/gluetun": "v3.41.0" } });
  for (const image of ["qmcgaw/gluetun:v3.40.0", "docker.io/qmcgaw/gluetun", "ghcr.io/qdm12/gluetun:latest"]) {
    const r = await runUpdateCheck({
      versions: { suite: { version: "dev" }, components: [row("gluetun", "", "v3.40.0", "self", "running", image)] },
      upstream: up,
      store: memStore(),
      now: () => NOW,
    });
    assert.deepEqual(r.rows, { "gluetun:": "v3.41.0" }, image);
  }
});
