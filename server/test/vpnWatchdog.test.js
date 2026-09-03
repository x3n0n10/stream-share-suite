// heal()'s decision logic against fake gluetun and fake instance-health HTTP
// servers — no real Docker, no real network. See watchdog/vpnWatchdog.js.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { heal, _setPacingForTests } from "../src/watchdog/vpnWatchdog.js";
import { freshDatabase } from "./helpers.js";

// Real pacing is tuned for gluetun actually settling (seconds); tests only
// need to prove the decision logic, not sit through it.
_setPacingForTests({ healthTimeout: 2000, settleWait: 5, settleMax: 20, reconnectSettle: 5 });

let gluetunServer;
let instanceServer;
let gluetunPort;
let instancePort;

// Mutable fake state, reset in beforeEach.
let gluetunStatus;
let gluetunIp;
let reconnectCount; // how many times gluetun has been told to stop (= a cycle)
let healthByKey; // apiKey -> { status, detail, recoverAfterReconnect }

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

before(async () => {
  gluetunServer = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/v1/vpn/status" && req.method === "GET") {
        return json(res, 200, { status: gluetunStatus });
      }
      if (req.url === "/v1/vpn/status" && req.method === "PUT") {
        const status = JSON.parse(body || "{}").status;
        if (status === "stopped") reconnectCount += 1;
        gluetunStatus = status || gluetunStatus;
        return json(res, 200, { status: gluetunStatus });
      }
      if (req.url === "/v1/publicip/ip" && req.method === "GET") {
        return json(res, 200, gluetunIp);
      }
      json(res, 404, {});
    });
  });
  await new Promise((resolve) => gluetunServer.listen(0, resolve));
  gluetunPort = gluetunServer.address().port;

  // One shared server for every fake instance, distinguished by X-API-Key —
  // simpler than a port per instance, and the real behaviour never depends on
  // two instances sharing a host anyway.
  instanceServer = createServer((req, res) => {
    if (req.url === "/api/internal/health") {
      const entry = healthByKey.get(req.headers["x-api-key"]);
      if (!entry) return json(res, 200, { status: "unknown", detail: null });

      const recovered = entry.recoverAfterReconnect !== undefined && reconnectCount >= entry.recoverAfterReconnect;
      const status = recovered ? "healthy" : entry.status;
      const httpStatus = status === "blocked" || status === "error" ? 503 : 200;
      return json(res, httpStatus, { status, detail: entry.detail || null });
    }
    json(res, 404, {});
  });
  await new Promise((resolve) => instanceServer.listen(0, resolve));
  instancePort = instanceServer.address().port;
});

after(() => {
  gluetunServer.close();
  instanceServer.close();
});

beforeEach(() => {
  freshDatabase();
  gluetunStatus = "running";
  gluetunIp = { public_ip: "1.2.3.4", country: "NL" };
  reconnectCount = 0;
  healthByKey = new Map();
});

function gluetunConfig() {
  return {
    url: `http://127.0.0.1:${gluetunPort}`,
    apiKey: "",
    basicAuth: null,
    statusPath: "/v1/vpn/status",
    timeoutMs: 2000,
    reconnectTimeoutMs: 5000,
  };
}

function instance(id, apiKey, { healthCheckEnabled = true } = {}) {
  return {
    id,
    name: id,
    url: `http://127.0.0.1:${instancePort}`,
    apiKey,
    healthCheckEnabled,
  };
}

function collectLog() {
  const lines = [];
  return { log: (line) => lines.push(line), lines };
}

test("does nothing when no instance has health checking enabled", async () => {
  const { log, lines } = collectLog();
  await heal({
    log,
    config: { instances: [instance("p1", "k1", { healthCheckEnabled: false })], gluetun: gluetunConfig() },
  });
  assert.ok(lines.some((l) => l.includes("nothing to watch")));
});

test("does nothing when gluetun is not configured", async () => {
  const { log, lines } = collectLog();
  await heal({ log, config: { instances: [instance("p1", "k1")], gluetun: null } });
  assert.ok(lines.some((l) => l.includes("not configured")));
});

test("does nothing when every watched instance is healthy", async () => {
  healthByKey.set("k1", { status: "healthy" });

  const { log, lines } = collectLog();
  await heal({ log, config: { instances: [instance("p1", "k1")], gluetun: gluetunConfig() } });

  assert.ok(lines.some((l) => l.includes("nothing to do")));
  assert.equal(reconnectCount, 0, "never reconnects when nothing is blocked");
});

test("never reconnects on an error or unknown verdict — only on blocked", async () => {
  healthByKey.set("k1", { status: "error", detail: "provider outage" });

  await heal({ config: { instances: [instance("p1", "k1")], gluetun: gluetunConfig() } });

  assert.equal(reconnectCount, 0);
});

test("reconnects once and recovers when the first attempt already fixes it", async () => {
  healthByKey.set("k1", { status: "blocked", recoverAfterReconnect: 1 });

  const { log, lines } = collectLog();
  await heal({ log, config: { instances: [instance("p1", "k1")], gluetun: gluetunConfig() } });

  assert.equal(reconnectCount, 1);
  assert.ok(lines.some((l) => l.includes("Recovered after 1 reconnect")));
});

test("keeps reconnecting until the provider recovers, within the budget", async () => {
  healthByKey.set("k1", { status: "blocked", recoverAfterReconnect: 3 });

  const { log, lines } = collectLog();
  await heal({ log, config: { instances: [instance("p1", "k1")], gluetun: gluetunConfig() } });

  assert.equal(reconnectCount, 3);
  assert.ok(lines.some((l) => l.includes("Recovered after 3 reconnect")));
});

test("gives up after the configured max reconnects when the provider never recovers", async () => {
  healthByKey.set("k1", { status: "blocked" }); // recoverAfterReconnect unset — never recovers

  const { log, lines } = collectLog();
  await heal({ log, config: { instances: [instance("p1", "k1")], gluetun: gluetunConfig() } });

  // maxReconnects defaults to 5 with nothing set in the store.
  assert.equal(reconnectCount, 5);
  assert.ok(lines.some((l) => l.includes("Reconnect attempt 5/5")));
  assert.ok(lines.some((l) => l.includes("Gave up after 5 reconnect")));
});

test("only instances with health checking enabled are probed at all", async () => {
  healthByKey.set("k1", { status: "blocked", recoverAfterReconnect: 1 }); // watched
  healthByKey.set("k2", { status: "blocked" }); // not watched

  const { log, lines } = collectLog();
  await heal({
    log,
    config: {
      instances: [instance("p1", "k1"), instance("p2", "k2", { healthCheckEnabled: false })],
      gluetun: gluetunConfig(),
    },
  });

  assert.ok(lines.some((l) => l.includes("p1")));
  assert.ok(!lines.some((l) => l.includes("p2")));
});

test("an instance that cannot be reached is never treated as blocked", async () => {
  const { log, lines } = collectLog();
  await heal({
    log,
    config: {
      instances: [{ id: "p1", name: "p1", url: "http://127.0.0.1:1", apiKey: "k1", healthCheckEnabled: true }],
      gluetun: gluetunConfig(),
    },
  });

  assert.ok(lines.some((l) => l.includes("could not reach it")));
  assert.ok(lines.some((l) => l.includes("nothing to do")));
  assert.equal(reconnectCount, 0);
});
