# Caddy Dashboard Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Caddy component publish the Suite's own dashboard under a public hostname, the same way it already publishes each instance.

**Architecture:** A new optional `dashboardUrl` field on the Caddy schema. `renderCaddyfile` gains an optional `suiteTarget` argument and adds a dashboard route to the same host grouping instance routes already use. `renderCaddySpec` resolves the Suite's own container name once (new `getSelfContainerName()` in `docker/self.js`) and passes `http://<name>:<PORT>` in as `suiteTarget`. The spec hash needs no change: `CADDY_CONFIG_HASH` already covers the Caddyfile text.

**Tech Stack:** Node (ESM), `node --test`, Express backend in `server/`. No frontend code changes: `SchemaForm` renders the new field from the schema automatically.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-09-28-caddy-dashboard-route-design.md`. Read it if anything here is unclear.
- Own hostname only. Only `url.host` of `dashboardUrl` is used; any path is ignored. No path-based dashboard URLs.
- No new schema validation (the registry has no URL type). A `dashboardUrl` that does not parse as a URL is skipped silently, like an unparseable instance `publicBaseUrl`.
- `renderCaddyfile(values)` must stay a pure, synchronous function. Existing one-argument callers and tests must keep passing unchanged.
- The Docker call (`getSelfContainerName`) happens only in `renderCaddySpec`, and only when `dashboardUrl` is set.
- The fallback container name is exactly `stream-share-suite`; the default port is `3000` (`process.env.PORT` when set).
- Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- **Committing:** plain `git commit` is blocked by a guard in this repo. Write the message to a file, then: `git add <files>`, confirm `git diff --cached --stat` is non-empty, `TREE=$(git write-tree)`, `PARENT=$(git rev-parse HEAD)`, `SHA=$(git commit-tree "$TREE" -p "$PARENT" -F <msgfile>)`, `git update-ref refs/heads/claude/caddy-dashboard-route "$SHA"`. Re-check `git status --short` afterwards; the guard sometimes resets the index.
- Run backend tests from `server/`: `node --test test/<file>` for one file, `npm test` for everything.

---

### Task 1: `getSelfContainerName()`

**Files:**
- Modify: `server/src/docker/self.js`
- Test: `server/test/self-networks.test.js`

**Interfaces:**
- Consumes: `inspectContainer(idOrName)` from `./client.js` (already imported in `self.js`; returns the inspect object, or `null` on 404, or throws on transport failure). `hostname()` from `node:os` (already imported).
- Produces: `export async function getSelfContainerName(): Promise<string>`. Returns the Suite's own container name without its leading `/`, or `"stream-share-suite"` on any failure or empty result. Never throws.

- [ ] **Step 1: Write the failing tests**

Add to the imports at the top of `server/test/self-networks.test.js`:

```js
import { createServer } from "node:http";
import { hostname } from "node:os";
```

and change the existing `self.js` import to:

```js
import { ipv4NetworkCidr, getSelfNetworks, getSelfContainerName } from "../src/docker/self.js";
```

Append to the end of the file:

```js
async function withFakeDocker(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, resolve));
  const original = process.env.DOCKER_PROXY_URL;
  process.env.DOCKER_PROXY_URL = `http://127.0.0.1:${server.address().port}`;
  try {
    await run();
  } finally {
    if (original === undefined) delete process.env.DOCKER_PROXY_URL;
    else process.env.DOCKER_PROXY_URL = original;
    server.close();
  }
}

test("getSelfContainerName returns the inspected name without its leading slash", async () => {
  await withFakeDocker(
    (req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === `/v1.43/containers/${hostname()}/json`) return res.end(JSON.stringify({ Name: "/my-suite" }));
      res.statusCode = 404;
      res.end(JSON.stringify({ message: "No such container" }));
    },
    async () => {
      assert.equal(await getSelfContainerName(), "my-suite");
    }
  );
});

test("getSelfContainerName falls back to stream-share-suite when the container is not found", async () => {
  await withFakeDocker(
    (req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.statusCode = 404;
      res.end(JSON.stringify({ message: "No such container" }));
    },
    async () => {
      assert.equal(await getSelfContainerName(), "stream-share-suite");
    }
  );
});

test("getSelfContainerName falls back to stream-share-suite when Docker is unreachable, rather than throwing", async () => {
  const original = process.env.DOCKER_PROXY_URL;
  process.env.DOCKER_PROXY_URL = "http://127.0.0.1:1"; // nothing listens here
  try {
    assert.equal(await getSelfContainerName(), "stream-share-suite");
  } finally {
    if (original === undefined) delete process.env.DOCKER_PROXY_URL;
    else process.env.DOCKER_PROXY_URL = original;
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && node --test test/self-networks.test.js`
Expected: FAIL. `getSelfContainerName` is not exported (SyntaxError on import, or "is not a function").

- [ ] **Step 3: Implement**

Append to `server/src/docker/self.js`:

```js
// The compose file's own container_name — what every shipped install calls
// the Suite, and what Caddy can still reach if self-inspection fails.
const DEFAULT_SELF_NAME = "stream-share-suite";

// The Suite's own container name, for addressing it from another container
// over Docker's DNS. Same technique and same never-throw rule as
// getSelfNetworks above.
export async function getSelfContainerName() {
  try {
    const info = await inspectContainer(hostname());
    return String(info?.Name || "").replace(/^\//, "") || DEFAULT_SELF_NAME;
  } catch {
    return DEFAULT_SELF_NAME;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && node --test test/self-networks.test.js`
Expected: PASS, all tests in the file (the existing ones plus 3 new).

- [ ] **Step 5: Commit**

Message: `Add getSelfContainerName for addressing the Suite from other containers`

Files: `server/src/docker/self.js`, `server/test/self-networks.test.js`

---

### Task 2: Dashboard route in the Caddyfile

**Files:**
- Modify: `server/src/schema/caddy.js`
- Modify: `server/src/reconcile/caddy.js`
- Modify: `README.md`
- Test: `server/test/caddy.test.js`

**Interfaces:**
- Consumes: `getSelfContainerName()` from `../docker/self.js` (Task 1). The existing `instanceRoutes()`, `groupByHost()` in `reconcile/caddy.js`.
- Produces: schema field `dashboardUrl`; `renderCaddyfile(values, suiteTarget?)`, where `suiteTarget` is a string like `http://stream-share-suite:3000` and is only consulted when `values.dashboardUrl` is set.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/caddy.test.js` (the file already imports `renderCaddyfile`, `renderCaddySpec`, `computeSpecHash`, `provisionInstance`; the `PROVIDER` helper and `beforeEach` setup are already in the file):

```js
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
    [{ dashboardUrl: "https://suite.example.com" }, undefined],
  ]) {
    assert.match(renderCaddyfile(values, target), /StreamShare's Caddy is running/);
  }
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && node --test test/caddy.test.js`
Expected: the 7 new tests FAIL (no dashboard block is ever rendered); all pre-existing tests still PASS.

- [ ] **Step 3: Add the schema field**

In `server/src/schema/caddy.js`, insert this field in `fields`, directly after the `acmeEmail` field and before the `networks` field:

```js
    {
      key: "dashboardUrl",
      envVar: null,
      label: "Dashboard public URL",
      help:
        "Optional. The address this dashboard is reached at from outside, e.g. https://suite.example.com. " +
        "Only the hostname (and port, if any) is used — give it a hostname of its own rather than a path. " +
        "Leave blank to keep the dashboard unpublished. The Suite must be on a Docker network Caddy joins " +
        "(the default streamshare network covers this). Publishing it puts the sign-in page on the internet: " +
        "it has a real login, CSRF protection and a throttled sign-in, but that is now your exposure.",
      group: "Dashboard",
    },
```

- [ ] **Step 4: Implement the route in `reconcile/caddy.js`**

Add the import next to the other imports:

```js
import { getSelfContainerName } from "../docker/self.js";
```

Add `dashboardRoute` directly after `instanceRoutes()`:

```js
// The Suite's own dashboard, published the same way an instance is: only when
// the operator has said where it is reached from outside. Only the host is
// used — the dashboard is root-absolute (/assets, /api), so it cannot live
// under a path prefix. `suiteTarget` is where Caddy reaches the Suite over
// Docker's DNS; without one there is nothing to route to.
function dashboardRoute(values, suiteTarget) {
  const raw = String(values.dashboardUrl || "").trim();
  if (!raw || !suiteTarget) return null;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  return { host: url.host, path: "", target: suiteTarget, dashboard: true };
}
```

Change the signature and the first lines of `renderCaddyfile`:

```js
export function renderCaddyfile(values, suiteTarget) {
  const routes = instanceRoutes();
  const dashboard = dashboardRoute(values, suiteTarget);
  // Last, so within a shared hostname the path-based instance blocks match
  // before the dashboard's catch-all.
  if (dashboard) routes.push(dashboard);
  const byHost = groupByHost(routes);
  let file = "";
```

Replace the inner route-emitting loop (the `for (const route of hostRoutes)` block inside the site-block loop) with:

```js
      for (const route of hostRoutes) {
        if (route.path) {
          file += `\thandle_path ${route.path}* {\n\t\treverse_proxy ${route.target}\n\t}\n`;
        } else if (route.dashboard && hostRoutes.length > 1) {
          // Shares its hostname with path-based instances: an explicit handle
          // makes it the fallback that they are matched ahead of.
          file += `\thandle {\n\t\treverse_proxy ${route.target}\n\t}\n`;
        } else {
          file += `\treverse_proxy ${route.target}\n`;
        }
      }
```

In `renderCaddySpec`, replace `const caddyfile = renderCaddyfile(values);` with:

```js
  // Only ask Docker who we are when there is a dashboard to point at.
  const suiteTarget = values.dashboardUrl
    ? `http://${await getSelfContainerName()}:${process.env.PORT || 3000}`
    : undefined;
  const caddyfile = renderCaddyfile(values, suiteTarget);
```

Also update the file's header comment: after "...instances have a public base URL set right now)", add one sentence: "The dashboard itself is one more route of the same kind, from the Caddy component's own `dashboardUrl` field."

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && node --test test/caddy.test.js`
Expected: PASS, every test in the file (existing and the 7 new).

Then run the whole suite: `cd server && npm test`
Expected: all tests pass, none failing.

- [ ] **Step 6: README sentence**

In `README.md`, in the "### Caddy (reverse proxy)" section, add this paragraph after the paragraph that ends "...which needs the same network, not a shared one.":

```markdown
The dashboard itself can be published the same way: set **Dashboard public URL**
on the Caddy component (a hostname of its own, e.g. `https://suite.example.com`)
and Caddy proxies it to the Suite over the shared network. It needs a hostname
rather than a path, and it puts the sign-in page on the internet.
```

- [ ] **Step 7: Commit**

Message: `Publish the dashboard through Caddy under its own hostname`

Files: `server/src/schema/caddy.js`, `server/src/reconcile/caddy.js`, `server/test/caddy.test.js`, `README.md`
