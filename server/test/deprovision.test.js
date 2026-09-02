// Removing an instance: the container comes down before the database is
// touched, not after — dropping a database an instance still holds
// connections against fails in PostgreSQL rather than succeeding against one
// that's already gone. Proven against a fake Docker daemon that actually
// tracks stop/remove calls, not just the pure ordering of the source code.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { deprovisionInstance, provisionInstance } from "../src/reconcile/provisioning.js";
import { instanceContainerName } from "../src/reconcile/instance.js";
import { getComponentValues, saveComponentValues } from "../src/store/components.js";
import { managedLabels } from "../src/docker/labels.js";
import { freshDatabase } from "./helpers.js";

let server;
let containers; // name -> { Id, Labels, running }
let requests;

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    req.on("data", () => {});
    req.on("end", () => {
      requests.push({ method: req.method, path: url.pathname });

      const m = url.pathname.match(/^\/v1\.43\/containers\/([^/]+)(\/(json|stop))?$/);
      if (m) {
        const idOrName = decodeURIComponent(m[1]);
        const action = m[3];
        const container =
          containers.get(idOrName) || [...containers.values()].find((c) => c.Id === idOrName);

        if (req.method === "GET" && action === "json") {
          res.writeHead(container ? 200 : 404, { "Content-Type": "application/json" });
          return res.end(JSON.stringify(container ? { Id: container.Id, Config: { Labels: container.Labels } } : { message: "no" }));
        }
        if (req.method === "POST" && action === "stop") {
          if (container) container.running = false;
          return res.writeHead(container ? 204 : 404).end();
        }
        if (req.method === "DELETE" && !action) {
          if (container) containers.delete(container.name);
          return res.writeHead(container ? 204 : 404).end();
        }
      }

      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: `unhandled ${req.method} ${url.pathname}` }));
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  process.env.DOCKER_PROXY_URL = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

beforeEach(() => {
  freshDatabase();
  containers = new Map();
  requests = [];
  // Postgres pointed at an external, unreachable host — enough to prove the
  // container comes down regardless of what happens to the database, without
  // needing a real PostgreSQL server for tests that don't ask for dropData.
  saveComponentValues("postgres", { mode: "external", host: "db.invalid", port: "5432", adminUser: "x", adminPassword: "y" });
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

function registerRunning(name, key) {
  containers.set(name, { Id: `id-${name}`, name, Labels: managedLabels("instance", "somehash", key), running: true });
}

function collectLog() {
  const lines = [];
  return { log: (line) => lines.push(line), lines };
}

test("removing an instance stops and removes its own Suite-managed container", async () => {
  const { key } = provisionInstance(PROVIDER);
  const name = instanceContainerName(key, getComponentValues("instance", key));
  registerRunning(name, key);

  const { log, lines } = collectLog();
  const removed = await deprovisionInstance(key, { dropData: false, log });

  assert.equal(removed, true);
  assert.equal(containers.has(name), false, "the container is actually gone");
  assert.ok(lines.some((l) => l.includes(`Stopping ${name}`)));
  assert.ok(lines.some((l) => l.includes(`Removing ${name}`)));

  // Stop and remove happen before the "removed from the stack" line that
  // reports the whole operation as done.
  const stopIndex = lines.findIndex((l) => l.includes("Stopping"));
  const doneIndex = lines.findIndex((l) => l.includes("Removed") && l.includes("from the stack"));
  assert.ok(stopIndex < doneIndex);
});

test("the container comes down before the database decision is logged", async () => {
  const { key } = provisionInstance(PROVIDER);
  const name = instanceContainerName(key, getComponentValues("instance", key));
  registerRunning(name, key);

  const { log, lines } = collectLog();
  await deprovisionInstance(key, { dropData: false, log });

  const stopIndex = lines.findIndex((l) => l.includes("Stopping"));
  const keepIndex = lines.findIndex((l) => l.includes("Keeping database"));
  assert.ok(stopIndex >= 0 && keepIndex >= 0);
  assert.ok(stopIndex < keepIndex, "the container is stopped before the database is even considered");
});

test("an adopted container — not the Suite's own — is left running, never stopped", async () => {
  const { key } = provisionInstance(PROVIDER);
  const name = instanceContainerName(key, getComponentValues("instance", key));
  containers.set(name, { Id: "foreign-id", name, Labels: {}, running: true }); // no Suite labels

  const { log, lines } = collectLog();
  await deprovisionInstance(key, { dropData: false, log });

  assert.equal(containers.has(name), true, "left running, untouched");
  assert.equal(containers.get(name).running, true);
  assert.equal(requests.some((r) => r.path.includes("/stop")), false);
  assert.ok(lines.some((l) => l.includes("was not created by the Suite")));
});

test("removing an instance with no running container at all just proceeds", async () => {
  const { key } = provisionInstance(PROVIDER);
  // Nothing registered in `containers` — inspectContainer resolves to null.
  const { log } = collectLog();
  const removed = await deprovisionInstance(key, { dropData: false, log });
  assert.equal(removed, true);
});

test("a database drop failure leaves the container already removed rather than undoing it", async () => {
  const { key } = provisionInstance(PROVIDER);
  const name = instanceContainerName(key, getComponentValues("instance", key));
  registerRunning(name, key);

  const { log } = collectLog();
  // postgres is "external" pointed at an unreachable host, so the drop step
  // itself will fail — proving that failure doesn't roll back the container
  // teardown that already succeeded ahead of it.
  await assert.rejects(() => deprovisionInstance(key, { dropData: true, log }));
  assert.equal(containers.has(name), false, "the container was already stopped and removed");
});

test("removing a never-configured instance key is a no-op, not an error", async () => {
  const { log } = collectLog();
  assert.equal(await deprovisionInstance("no-such-key", { log }), false);
});
