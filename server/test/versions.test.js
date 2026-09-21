// What each row of the sidebar's version block reads. The interesting part is
// the ordering of "ask the component" against "read what the image says", and
// that no single slow or failing lookup can hold the rest up.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  imageVersion,
  collectVersions,
  getVersions,
  invalidateVersions,
  _resetVersionsCache,
} from "../src/reconcile/versions.js";

const LABEL = "org.opencontainers.image.version";

// ---- imageVersion -------------------------------------------------------

test("imageVersion prefers the version label over the tag and image ID", () => {
  assert.deepEqual(
    imageVersion({ labels: { [LABEL]: "1.3.0" }, imageRef: "ghcr.io/x/y:2.0", imageId: "sha256:abcdef1234567890" }),
    { version: "1.3.0", source: "image-label" }
  );
});

test("imageVersion uses a specific tag when there is no label", () => {
  assert.deepEqual(imageVersion({ labels: {}, imageRef: "caddy:2.8", imageId: "sha256:abcdef1234567890" }), {
    version: "2.8",
    source: "tag",
  });
  assert.deepEqual(imageVersion({ labels: null, imageRef: "postgres:14-alpine", imageId: "sha256:aa" }), {
    version: "14-alpine",
    source: "tag",
  });
});

test("imageVersion falls to the short image ID for latest and untagged refs", () => {
  const id = "sha256:0123456789abcdef0123";
  assert.deepEqual(imageVersion({ labels: {}, imageRef: "qmcgaw/gluetun:latest", imageId: id }), {
    version: "0123456789ab",
    source: "image-id",
  });
  assert.deepEqual(imageVersion({ labels: {}, imageRef: "qmcgaw/gluetun", imageId: id }), {
    version: "0123456789ab",
    source: "image-id",
  });
});

test("imageVersion does not mistake a registry port or a digest for a tag", () => {
  const id = "sha256:fedcba9876543210ffff";
  assert.equal(imageVersion({ labels: {}, imageRef: "myregistry:5000/repo", imageId: id }).source, "image-id");
  assert.equal(imageVersion({ labels: {}, imageRef: "repo@sha256:abc123", imageId: id }).source, "image-id");
});

test("imageVersion returns nulls when nothing is known", () => {
  assert.deepEqual(imageVersion({ labels: {}, imageRef: "", imageId: "" }), { version: null, source: null });
  assert.deepEqual(imageVersion({}), { version: null, source: null });
});

// ---- collectVersions ----------------------------------------------------

function fakeLookups({ containers = {}, images = {}, ...overrides } = {}) {
  const calls = { instanceVersion: [], gluetunVersion: [], postgresVersion: [] };
  return {
    calls,
    inspectContainer: async (name) => {
      const c = containers[name];
      if (c instanceof Error) throw c;
      return c ?? null;
    },
    inspectImage: async (id) => images[id] ?? null,
    instanceVersion: async (instance, opts) => {
      calls.instanceVersion.push({ instance, opts });
      throw new Error("no endpoint");
    },
    gluetunVersion: async (g) => {
      calls.gluetunVersion.push(g);
      throw new Error("down");
    },
    postgresVersion: async (t) => {
      calls.postgresVersion.push(t);
      throw new Error("down");
    },
    ...overrides,
  };
}

const running = (image, imageId) => ({ State: { Running: true }, Config: { Image: image }, Image: imageId });
const stopped = (image, imageId) => ({ State: { Running: false }, Config: { Image: image }, Image: imageId });

const BASE = { instances: [], components: [], gluetun: null, postgres: null, suiteVersion: "1.0.0" };

test("collectVersions reports the suite version as given", async () => {
  const out = await collectVersions({ ...BASE, suiteVersion: "dev-abc1234" }, fakeLookups());
  assert.deepEqual(out, { suite: { version: "dev-abc1234" }, components: [] });
});

test("a running instance reports its own version and marks the source self", async () => {
  const lookups = fakeLookups({
    containers: { "ss-p1": running("ghcr.io/x3n0n10/stream-share:latest", "sha256:aaaa") },
    instanceVersion: async () => "1.4.2",
  });
  const inst = { id: "p1", name: "Provider 1", url: "http://ss-p1:8080", apiKey: "k", containerName: "ss-p1" };
  const out = await collectVersions({ ...BASE, instances: [inst] }, lookups);
  assert.deepEqual(out.components, [
    { kind: "instance", key: "p1", label: "Provider 1", status: "running", version: "1.4.2", source: "self" },
  ]);
});

test("an instance whose endpoint fails falls back to the image label", async () => {
  const lookups = fakeLookups({
    containers: { "ss-p1": running("ghcr.io/x3n0n10/stream-share:latest", "sha256:aaaa") },
    images: { "sha256:aaaa": { Config: { Labels: { [LABEL]: "1.3.0" } } } },
  });
  const inst = { id: "p1", name: "Provider 1", url: "http://x", apiKey: "k", containerName: "ss-p1" };
  const out = await collectVersions({ ...BASE, instances: [inst] }, lookups);
  assert.deepEqual(out.components[0], {
    kind: "instance",
    key: "p1",
    label: "Provider 1",
    status: "running",
    version: "1.3.0",
    source: "image-label",
  });
});

test("a stopped container reports stopped and is not asked for its version", async () => {
  const lookups = fakeLookups({
    containers: { "ss-p1": stopped("ghcr.io/x3n0n10/stream-share:latest", "sha256:aaaa") },
  });
  const inst = { id: "p1", name: "Provider 1", url: "http://x", apiKey: "k", containerName: "ss-p1" };
  const out = await collectVersions({ ...BASE, instances: [inst] }, lookups);
  assert.equal(out.components[0].status, "stopped");
  assert.equal(out.components[0].version, null);
  assert.equal(out.components[0].source, null);
  assert.equal(lookups.calls.instanceVersion.length, 0);
});

test("an instance the Suite does not run has unknown status and only its own report", async () => {
  const ok = fakeLookups({ instanceVersion: async () => "2.0.0" });
  const inst = { id: "ext", name: "External", url: "http://elsewhere", apiKey: "k", containerName: null };
  const withVersion = await collectVersions({ ...BASE, instances: [inst] }, ok);
  assert.deepEqual(withVersion.components[0], {
    kind: "instance",
    key: "ext",
    label: "External",
    status: "unknown",
    version: "2.0.0",
    source: "self",
  });

  const failing = await collectVersions({ ...BASE, instances: [inst] }, fakeLookups());
  assert.equal(failing.components[0].status, "unknown");
  assert.equal(failing.components[0].version, null);
  assert.equal(failing.components[0].source, null);
});

test("when Docker cannot be inspected the row is unknown but the component is still asked", async () => {
  const lookups = fakeLookups({
    containers: { "ss-p1": new Error("proxy down") },
    instanceVersion: async () => "1.4.2",
  });
  const inst = { id: "p1", name: "Provider 1", url: "http://x", apiKey: "k", containerName: "ss-p1" };
  const out = await collectVersions({ ...BASE, instances: [inst] }, lookups);
  assert.equal(out.components[0].status, "unknown");
  assert.equal(out.components[0].version, "1.4.2");
  assert.equal(out.components[0].source, "self");
});

test("gluetun and PostgreSQL are asked with their own connection objects; Caddy uses its image tag", async () => {
  const gluetunClient = { url: "http://gluetun:8000", apiKey: "gk" };
  const pgTarget = { host: "pg", port: 5432, user: "postgres", password: "x" };
  const lookups = fakeLookups({
    containers: {
      gluetun: running("qmcgaw/gluetun:latest", "sha256:g"),
      pg: running("postgres:14-alpine", "sha256:p"),
      caddy: running("caddy:2.8", "sha256:c"),
    },
    gluetunVersion: async (g) => (g === gluetunClient ? "v3.40.0" : null),
    postgresVersion: async (t) => (t === pgTarget ? "14.13" : null),
  });
  const components = [
    { kind: "gluetun", key: "", label: "Gluetun (VPN)", containerName: "gluetun" },
    { kind: "postgres", key: "", label: "PostgreSQL", containerName: "pg" },
    { kind: "caddy", key: "", label: "Caddy (reverse proxy)", containerName: "caddy" },
  ];
  const out = await collectVersions({ ...BASE, components, gluetun: gluetunClient, postgres: pgTarget }, lookups);
  assert.deepEqual(
    out.components.map((r) => [r.kind, r.version, r.source]),
    [
      ["gluetun", "v3.40.0", "self"],
      ["postgres", "14.13", "self"],
      ["caddy", "2.8", "tag"],
    ]
  );
});

test("one hanging lookup is cut off by the timeout and does not hold up the others", async () => {
  const lookups = fakeLookups({
    containers: { "ss-p1": running("ghcr.io/x3n0n10/stream-share:1.2", "sha256:aaaa") },
    instanceVersion: (inst) => (inst.id === "p2" ? Promise.resolve("9.9") : new Promise(() => {})),
  });
  const hung = { id: "p1", name: "Hung", url: "http://x", apiKey: "k", containerName: "ss-p1" };
  const fast = { id: "p2", name: "Fast", url: "http://y", apiKey: "k", containerName: null };

  const started = Date.now();
  const out = await collectVersions({ ...BASE, instances: [hung, fast] }, lookups, 50);

  assert.ok(Date.now() - started < 1500, "must not wait on the hung lookup");
  assert.equal(out.components[0].version, "1.2");
  assert.equal(out.components[0].source, "tag");
  assert.equal(out.components[1].version, "9.9");
});

// ---- getVersions cache --------------------------------------------------

beforeEach(() => _resetVersionsCache());

test("getVersions serves a second call within the TTL without collecting again", async () => {
  let calls = 0;
  let clock = 1_000;
  const collect = async () => ({ suite: { version: `v${++calls}` }, components: [] });
  const opts = { collect, now: () => clock };

  const first = await getVersions({}, opts);
  clock += 30_000;
  const second = await getVersions({}, opts);

  assert.equal(calls, 1);
  assert.equal(second.suite.version, first.suite.version);
});

test("getVersions collects again once the TTL has passed", async () => {
  let calls = 0;
  let clock = 1_000;
  const collect = async () => ({ suite: { version: `v${++calls}` }, components: [] });
  const opts = { collect, now: () => clock };

  await getVersions({}, opts);
  clock += 61_000;
  const again = await getVersions({}, opts);

  assert.equal(calls, 2);
  assert.equal(again.suite.version, "v2");
});

test("concurrent getVersions calls share one in-flight collection", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const collect = async () => {
    calls += 1;
    await gate;
    return { suite: { version: "x" }, components: [] };
  };
  const opts = { collect, now: () => 1_000 };

  const a = getVersions({}, opts);
  const b = getVersions({}, opts);
  release();
  await Promise.all([a, b]);

  assert.equal(calls, 1);
});

test("invalidateVersions makes the next call collect again inside the TTL", async () => {
  let calls = 0;
  const collect = async () => ({ suite: { version: `v${++calls}` }, components: [] });
  const opts = { collect, now: () => 1_000 };

  await getVersions({}, opts);
  invalidateVersions();
  const again = await getVersions({}, opts);

  assert.equal(calls, 2);
  assert.equal(again.suite.version, "v2");
});

test("a collection that started before an invalidation does not cache its stale result", async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let calls = 0;
  const collect = async () => {
    calls += 1;
    if (calls === 1) await gate;
    return { suite: { version: `v${calls}` }, components: [] };
  };
  const opts = { collect, now: () => 1_000 };

  const stale = getVersions({}, opts);
  invalidateVersions();
  release();
  await stale;

  const fresh = await getVersions({}, opts);
  assert.equal(calls, 2, "the stale result must not have been served from the cache");
  assert.equal(fresh.suite.version, "v2");
});

test("a stopped container is not asked for its image", async () => {
  let imageCalls = 0;
  const lookups = {
    inspectContainer: async () => ({ State: { Running: false }, Config: { Image: "x:1" }, Image: "sha256:aa" }),
    inspectImage: async () => {
      imageCalls += 1;
      return null;
    },
    instanceVersion: async () => "1",
    gluetunVersion: async () => "1",
    postgresVersion: async () => "1",
  };
  const inst = { id: "p1", name: "P1", url: "http://x", apiKey: "k", containerName: "c" };
  const out = await collectVersions(
    { instances: [inst], components: [], gluetun: null, postgres: null, suiteVersion: "1" },
    lookups
  );
  assert.equal(out.components[0].status, "stopped");
  assert.equal(imageCalls, 0);
});
