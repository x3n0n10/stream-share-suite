// End-to-end over real HTTP. This is where the security boundary is proven:
// that nothing behind the gate answers without a session, that state-changing
// requests need the CSRF echo, and that secrets never come back out.

import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers.js";
import { createApp } from "../src/app.js";
import { _resetLoginThrottle } from "../src/auth/middleware.js";

let server;
let base;

before(async () => {
  server = createApp({ serveStatic: false }).listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

beforeEach(() => {
  freshDatabase();
  // The throttle is module state by design, so reset it between cases.
  _resetLoginThrottle();
});

// Threads the session cookie and the CSRF echo through, the way the browser
// client does.
function client() {
  let cookie = null;
  let csrf = null;

  async function call(method, path, body) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrf ? { "X-Suite-CSRF": csrf } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const json = await res.json().catch(() => ({}));
    if (json.csrfToken) csrf = json.csrfToken;
    return { status: res.status, body: json };
  }

  return {
    get: (p) => call("GET", p),
    post: (p, b) => call("POST", p, b),
    put: (p, b) => call("PUT", p, b),
    del: (p) => call("DELETE", p),
    dropCsrf: () => {
      csrf = null;
    },
    hasCookie: () => !!cookie,
  };
}

const PASSWORD = "a-sufficiently-long-password";

async function signedIn() {
  const c = client();
  await c.post("/api/auth/setup", { username: "admin", password: PASSWORD });
  return c;
}

test("healthz answers without a session", async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok" });
});

test("a fresh install reports that setup is required", async () => {
  const c = client();
  const { status, body } = await c.get("/api/auth/status");
  assert.equal(status, 200);
  assert.equal(body.setupRequired, true);
  assert.equal(body.authenticated, false);
});

test("everything behind the gate refuses an anonymous caller", async () => {
  const c = client();
  for (const path of ["/api/config", "/api/overview", "/api/settings", "/api/settings/instances"]) {
    const { status, body } = await c.get(path);
    assert.equal(status, 401, `${path} should require auth`);
    assert.equal(body.setupRequired, true);
  }
});

test("setup creates the admin, signs in, and cannot be run twice", async () => {
  const c = await signedIn();
  assert.equal(c.hasCookie(), true);

  const status = await c.get("/api/auth/status");
  assert.equal(status.body.authenticated, true);
  assert.equal(status.body.username, "admin");
  assert.equal(status.body.setupRequired, false);

  const second = await client().post("/api/auth/setup", { username: "other", password: PASSWORD });
  assert.equal(second.status, 409);
});

test("setup refuses a weak password", async () => {
  const { status, body } = await client().post("/api/auth/setup", { username: "admin", password: "short" });
  assert.equal(status, 400);
  assert.match(body.error, /at least 12/);
});

test("sign-in works and a wrong password does not", async () => {
  await signedIn();

  const good = await client().post("/api/auth/login", { username: "admin", password: PASSWORD });
  assert.equal(good.status, 200);

  const bad = await client().post("/api/auth/login", { username: "admin", password: "wrong-password" });
  assert.equal(bad.status, 401);
  // Same message either way — the response must not confirm the username.
  const noUser = await client().post("/api/auth/login", { username: "ghost", password: "wrong-password" });
  assert.equal(noUser.body.error, bad.body.error);
});

test("a state-changing request without the CSRF echo is refused", async () => {
  const c = await signedIn();
  c.dropCsrf();
  const { status } = await c.post("/api/settings/instances", {
    name: "P",
    url: "http://a:8080",
    apiKey: "k",
  });
  assert.equal(status, 403);
});

test("instances round-trip through the API without ever returning the key", async () => {
  const c = await signedIn();

  const created = await c.post("/api/settings/instances", {
    name: "Provider 1",
    url: "http://172.18.0.11:8080/",
    apiKey: "super-secret-key",
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.instance.id, "provider-1");
  // Trailing slash stripped at the boundary.
  assert.equal(created.body.instance.url, "http://172.18.0.11:8080");
  assert.equal(created.body.instance.apiKeySet, true);

  const listed = await c.get("/api/settings/instances");
  assert.equal(JSON.stringify(listed.body).includes("super-secret-key"), false);

  // And it reaches the request path, which is what /api/config reflects.
  const config = await c.get("/api/config");
  assert.deepEqual(config.body.instances.map((i) => i.name), ["Provider 1"]);
  assert.equal(JSON.stringify(config.body).includes("super-secret-key"), false);
});

test("editing without sending a key keeps the stored one", async () => {
  const c = await signedIn();
  await c.post("/api/settings/instances", { name: "P", url: "http://a:8080", apiKey: "keep-me" });

  const updated = await c.put("/api/settings/instances/p", { name: "Renamed" });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.instance.name, "Renamed");
  assert.equal(updated.body.instance.apiKeySet, true);
});

test("an instance is refused without an API key or with a bad URL", async () => {
  const c = await signedIn();

  const noKey = await c.post("/api/settings/instances", { name: "P", url: "http://a:8080" });
  assert.equal(noKey.status, 400);
  assert.match(noKey.body.error, /API key/);

  const badUrl = await c.post("/api/settings/instances", { name: "P", url: "a:8080", apiKey: "k" });
  assert.equal(badUrl.status, 400);
  assert.match(badUrl.body.error, /http:\/\/ or https:\/\//);

  const noName = await c.post("/api/settings/instances", { name: "  ", url: "http://a:8080", apiKey: "k" });
  assert.equal(noName.status, 400);
});

test("gluetun credentials are write-only over the API", async () => {
  const c = await signedIn();

  await c.put("/api/settings", {
    gluetun: { url: "http://172.18.0.11:8000", user: "admin", password: "vpn-password" },
  });

  const read = await c.get("/api/settings");
  assert.equal(read.body.gluetun.url, "http://172.18.0.11:8000");
  assert.equal(read.body.gluetun.user, "admin");
  assert.equal(read.body.gluetun.passwordSet, true);
  assert.equal(JSON.stringify(read.body).includes("vpn-password"), false);

  // Omitting the password on a later save must not wipe it.
  await c.put("/api/settings", { gluetun: { user: "root" } });
  const again = await c.get("/api/settings");
  assert.equal(again.body.gluetun.user, "root");
  assert.equal(again.body.gluetun.passwordSet, true);

  // Explicit null clears it.
  await c.put("/api/settings", { gluetun: { password: null } });
  assert.equal((await c.get("/api/settings")).body.gluetun.passwordSet, false);
});

test("setting a gluetun URL turns the VPN page on", async () => {
  const c = await signedIn();
  assert.equal((await c.get("/api/config")).body.gluetun.enabled, false);

  await c.put("/api/settings", { gluetun: { url: "http://172.18.0.11:8000" } });
  assert.equal((await c.get("/api/config")).body.gluetun.enabled, true);
});

test("deleting an instance removes it from the request path", async () => {
  const c = await signedIn();
  await c.post("/api/settings/instances", { name: "P", url: "http://a:8080", apiKey: "k" });

  assert.equal((await c.del("/api/settings/instances/p")).status, 200);
  assert.equal((await c.del("/api/settings/instances/p")).status, 404);
  assert.deepEqual((await c.get("/api/config")).body.instances, []);
});

test("signing out invalidates the session", async () => {
  const c = await signedIn();
  assert.equal((await c.get("/api/config")).status, 200);

  await c.post("/api/auth/logout");
  const after = await c.get("/api/config");
  assert.equal(after.status, 401);
  assert.equal(after.body.setupRequired, false);
});

test("changing the password requires the current one", async () => {
  const c = await signedIn();

  const wrong = await c.post("/api/auth/password", {
    currentPassword: "not-the-password",
    newPassword: "another-long-password",
  });
  assert.equal(wrong.status, 401);

  const ok = await c.post("/api/auth/password", {
    currentPassword: PASSWORD,
    newPassword: "another-long-password",
  });
  assert.equal(ok.status, 200);

  assert.equal(
    (await client().post("/api/auth/login", { username: "admin", password: "another-long-password" })).status,
    200
  );
});

test("an unknown instance id is a 404, not a crash", async () => {
  const c = await signedIn();
  assert.equal((await c.get("/api/instances/nope/users/bob/history")).status, 404);
  assert.equal((await c.put("/api/settings/instances/nope", { name: "x" })).status, 404);
});

test("with no instances configured, aggregate endpoints return empty rather than erroring", async () => {
  const c = await signedIn();
  const overview = await c.get("/api/overview");
  assert.equal(overview.status, 200);
  assert.deepEqual(overview.body.instances, []);

  const users = await c.get("/api/users");
  assert.deepEqual(users.body, { users: [], errors: [] });
});

test("gluetun endpoints report disabled rather than failing when unconfigured", async () => {
  const c = await signedIn();
  assert.deepEqual((await c.get("/api/gluetun")).body, { enabled: false });
  assert.equal((await c.post("/api/gluetun/reconnect")).status, 404);
});
