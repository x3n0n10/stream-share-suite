# Health check channel picker (Suite side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the wizard's blind "Probe channel id" text field with a search-by-name autocomplete, backed by a new stream-share endpoint, while keeping manual entry working exactly as it does today.

**Architecture:** A thin proxy hop — `instanceClient.searchChannels` calls the instance's (not-yet-built) `/api/internal/channels?q=` endpoint, a new `ops.js` route resolves the instance and forwards the query, and `StepHealthCheck.jsx` debounces the existing stream-ID input into that route and renders a dropdown of matches. The text field stays the source of truth; picking a suggestion just fills it.

**Tech Stack:** Node.js/Express (`server/`), React (`web/`), `node --test` (Suite's test runner, no framework beyond the stdlib).

**Spec:** `docs/superpowers/specs/2026-09-13-health-check-channel-picker-design.md`

**Depends on:** the companion stream-share plan (`docs/superpowers/plans/2026-09-13-health-check-channel-search-api.md` in the `stream-share` repo), which builds `GET /api/internal/channels?q=` — the endpoint `instanceClient.searchChannels` calls. Tasks 1 and 2 below can be written and unit-tested against a fake HTTP server without that endpoint existing yet (that's exactly what the fake server in each test *is*), but end-to-end behavior needs both plans deployed together.

## Global Constraints

- Response envelope from the instance is `{ success, data }` (`types.APIResponse`); `data` is an array of `{ StreamID, Name, Category }` — PascalCase, no JSON tag renaming, per the spec.
- A failed or empty channel search must never block the wizard step or show in its `ErrorNote` — the field still works as free text.
- No new npm dependencies, no new frontend test framework (none exists in `web/` today) — verify the UI task manually.

---

### Task 1: `instanceClient.searchChannels`

**Files:**
- Modify: `server/src/instanceClient.js` (add function near `searchVOD`, `server/src/instanceClient.js:135`)
- Test: `server/test/instance-channels.test.js` (create)

**Interfaces:**
- Consumes: `callInstance(instance, path, { timeoutMs, query, method, body })` — already defined in this file (`server/src/instanceClient.js:11`), returns `responseBody.data` on success, throws `InstanceError` otherwise.
- Produces: `searchChannels(instance, query, { timeoutMs }) → Promise<Array<{ StreamID, Name, Category }>>`, used by Task 2.

- [ ] **Step 1: Write the failing test**

Create `server/test/instance-channels.test.js`:

```js
// searchChannels is a thin GET wrapper — this proves the query lands in the
// URL correctly and that the instance's envelope (success/data or
// success:false/error) is unwrapped the same way every other instanceClient
// call handles it.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { searchChannels } from "../src/instanceClient.js";

let server;
let nextResponse;

before(async () => {
  server = createServer((req, res) => {
    res.writeHead(nextResponse.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(nextResponse.body));
  });
  await new Promise((resolve) => server.listen(0, resolve));
});

after(() => server.close());

function instance() {
  return { url: `http://127.0.0.1:${server.address().port}`, apiKey: "k" };
}

test("returns the matches from a successful search", async () => {
  nextResponse = {
    status: 200,
    body: { success: true, data: [{ StreamID: "42", Name: "BBC One", Category: "UK" }] },
  };
  assert.deepEqual(await searchChannels(instance(), "bbc", { timeoutMs: 2000 }), [
    { StreamID: "42", Name: "BBC One", Category: "UK" },
  ]);
});

test("sends the query as ?q=", async () => {
  let seenUrl;
  server.close();
  server = createServer((req, res) => {
    seenUrl = req.url;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, data: [] }));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  await searchChannels(instance(), "bbc one", { timeoutMs: 2000 });
  assert.equal(seenUrl, "/api/internal/channels?q=bbc+one");
});

test("throws on an error response", async () => {
  nextResponse = { status: 502, body: { success: false, error: "provider unreachable" } };
  await assert.rejects(
    () => searchChannels(instance(), "bbc", { timeoutMs: 2000 }),
    /provider unreachable/
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && node --test test/instance-channels.test.js`
Expected: FAIL — `searchChannels` is not exported from `../src/instanceClient.js`.

- [ ] **Step 3: Implement `searchChannels`**

In `server/src/instanceClient.js`, add directly after `searchVOD` (after line 141, the closing brace of `searchVOD`):

```js
// Suggests live channels by name for the health-check wizard step, so an
// operator doesn't have to already know a raw Xtream stream ID.
export async function searchChannels(instance, query, { timeoutMs }) {
  return callInstance(instance, "/channels", {
    timeoutMs,
    query: { q: query },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && node --test test/instance-channels.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/instanceClient.js server/test/instance-channels.test.js
git commit -m "$(cat <<'EOF'
Add searchChannels to instanceClient

Thin GET wrapper for the new /api/internal/channels endpoint, the same
shape as every other instanceClient call — used by the health-check
wizard's channel picker.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `ops.js` route + `api.js` wrapper

**Files:**
- Modify: `server/src/routes/ops.js` (import + new route, near `server/src/routes/ops.js:290` — the `/instances/:id/vod/download` route)
- Modify: `web/src/lib/api.js` (add wrapper near `web/src/lib/api.js:143`)
- Test: `server/test/ops-health-check-channels.test.js` (create)

**Interfaces:**
- Consumes: `searchChannels(instance, query, { timeoutMs })` from Task 1; `findInstance(config, id)` and `failure(res, err)`, both already defined in `ops.js` (lines 22 and 54).
- Produces: `GET /api/instances/:id/health-check/channels?q=` → `{ results: Array<{ StreamID, Name, Category }> }` on success, `404` for an unknown instance, the upstream error status otherwise. `api.healthCheckChannels(instanceKey, q)` on the frontend, used by Task 3.

- [ ] **Step 1: Write the failing test**

Create `server/test/ops-health-check-channels.test.js`:

```js
// End-to-end over real HTTP: the route resolves the right instance, forwards
// the query, and never turns a provider hiccup into a crash — just an error
// status the wizard is expected to swallow.

import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { freshDatabase, signedInClient } from "./helpers.js";
import { createApp } from "../src/app.js";
import { _resetLoginThrottle } from "../src/auth/middleware.js";
import { createInstance } from "../src/store/instances.js";

let appServer;
let base;
let instanceServer;
let nextResponse;

before(async () => {
  appServer = createApp({ serveStatic: false }).listen(0);
  await new Promise((resolve) => appServer.once("listening", resolve));
  base = `http://127.0.0.1:${appServer.address().port}`;

  instanceServer = createServer((req, res) => {
    res.writeHead(nextResponse.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(nextResponse.body));
  });
  await new Promise((resolve) => instanceServer.listen(0, resolve));
});

after(() => {
  appServer.close();
  instanceServer.close();
});

beforeEach(() => {
  freshDatabase();
  _resetLoginThrottle();
  nextResponse = { status: 200, body: { success: true, data: [] } };
});

function addInstance() {
  return createInstance({
    name: "Main",
    url: `http://127.0.0.1:${instanceServer.address().port}`,
    apiKey: "k",
  });
}

test("returns matches from the instance's own search", async () => {
  const instance = addInstance();
  nextResponse = {
    status: 200,
    body: { success: true, data: [{ StreamID: "42", Name: "BBC One", Category: "UK" }] },
  };

  const client = await signedInClient(base);
  const res = await client.get(`/api/instances/${instance.id}/health-check/channels?q=bbc`);

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.results, [{ StreamID: "42", Name: "BBC One", Category: "UK" }]);
});

test("404s for an unknown instance", async () => {
  const client = await signedInClient(base);
  const res = await client.get("/api/instances/does-not-exist/health-check/channels?q=bbc");
  assert.equal(res.status, 404);
});

test("skips the instance call and returns no results for an empty query", async () => {
  const instance = addInstance();
  const client = await signedInClient(base);
  const res = await client.get(`/api/instances/${instance.id}/health-check/channels`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.results, []);
});

test("responds with an error status, not a crash, when the instance call fails", async () => {
  const instance = addInstance();
  nextResponse = { status: 502, body: { success: false, error: "provider unreachable" } };

  const client = await signedInClient(base);
  const res = await client.get(`/api/instances/${instance.id}/health-check/channels?q=bbc`);
  assert.equal(res.status, 502);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && node --test test/ops-health-check-channels.test.js`
Expected: FAIL — 404 for every request (route does not exist yet).

- [ ] **Step 3: Implement the route and the frontend wrapper**

In `server/src/routes/ops.js`, add `searchChannels` to the existing `instanceClient.js` import block (line 19, alongside `searchVOD`):

```js
  searchVOD,
  createVODDownload,
  searchChannels,
```

Add the route directly after the `/instances/:id/vod/download` route (after line 306, its closing `});`):

```js
  // Suggests live channels by name for the health-check wizard step, so an
  // operator doesn't have to already know a raw Xtream stream ID. A failure
  // here is the picker's problem, not the wizard's — the field still works
  // as free text either way, so this is never surfaced as an ErrorNote.
  router.get("/instances/:id/health-check/channels", async (req, res) => {
    const instance = findInstance(req.config, req.params.id);
    if (!instance) return res.status(404).json({ error: "Unknown instance" });

    const query = (req.query.q || "").toString().trim();
    if (!query) return res.json({ results: [] });

    try {
      const results = await searchChannels(instance, query, {
        timeoutMs: req.config.vodSearchTimeoutMs,
      });
      res.json({ results });
    } catch (err) {
      failure(res, err);
    }
  });
```

In `web/src/lib/api.js`, add next to `vodSearch` (line 143):

```js
  healthCheckChannels: (instanceKey, q) =>
    get(`/api/instances/${instanceKey}/health-check/channels`, { q }),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && node --test test/ops-health-check-channels.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the full server test suite to check for regressions**

Run: `cd server && npm test`
Expected: PASS (all existing tests plus the two new files)

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/ops.js web/src/lib/api.js server/test/ops-health-check-channels.test.js
git commit -m "$(cat <<'EOF'
Add the health-check channel search route

GET /api/instances/:id/health-check/channels proxies to the instance's
new channel search, 404s for an unknown instance, and turns any upstream
failure into an error status rather than a crash — the wizard already
treats a failed lookup as "no suggestions", not an error.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Wizard UI — search-by-name dropdown

**Files:**
- Modify: `web/src/pages/setup/StepHealthCheck.jsx`

**Interfaces:**
- Consumes: `api.healthCheckChannels(instanceKey, q)` from Task 2, resolving to `{ results: Array<{ StreamID, Name, Category }> }`.
- Produces: nothing consumed elsewhere — this is the leaf of the feature.

No automated test: `web/` has no test framework or test files today (checked — no `*.test.jsx`, no test script in `web/package.json`), and adding one for a single component is out of scope for this feature. Verified manually in Step 3 below.

- [ ] **Step 1: Add debounced search state and handlers**

In `web/src/pages/setup/StepHealthCheck.jsx`, change the import line (line 1) to add `useRef`:

```jsx
import { useEffect, useRef, useState } from "react";
```

Add new state declarations directly after the existing ones (after line 11, `const [error, setError] = useState(null);`):

```jsx
  const [suggestions, setSuggestions] = useState({}); // key -> array of {StreamID, Name, Category}
  const [pickedNames, setPickedNames] = useState({}); // key -> caption string
  const debounceTimers = useRef({});

  useEffect(() => {
    // Cancel any in-flight debounce on unmount, e.g. navigating away mid-type.
    return () => Object.values(debounceTimers.current).forEach(clearTimeout);
  }, []);

  function onStreamIdChange(key, value) {
    setStreamIds((prev) => ({ ...prev, [key]: value }));
    setPickedNames((prev) => ({ ...prev, [key]: "" }));

    clearTimeout(debounceTimers.current[key]);
    const query = value.trim();
    if (!query) {
      setSuggestions((prev) => ({ ...prev, [key]: [] }));
      return;
    }
    debounceTimers.current[key] = setTimeout(async () => {
      try {
        const { results } = await api.healthCheckChannels(key, query);
        setSuggestions((prev) => ({ ...prev, [key]: results || [] }));
      } catch (err) {
        console.warn(`Channel search failed for ${key}:`, err.message);
        setSuggestions((prev) => ({ ...prev, [key]: [] }));
      }
    }, 300);
  }

  function pickChannel(key, match) {
    clearTimeout(debounceTimers.current[key]);
    setStreamIds((prev) => ({ ...prev, [key]: match.StreamID }));
    setPickedNames((prev) => ({
      ...prev,
      [key]: match.Category ? `${match.Category} — ${match.Name}` : match.Name,
    }));
    setSuggestions((prev) => ({ ...prev, [key]: [] }));
  }
```

- [ ] **Step 2: Wire the input to a dropdown**

Replace the per-instance `<label>` block (lines 109-119 in the original file — the one rendering the plain stream-ID `<input>`) with:

```jsx
              <label key={instance.key} className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  {instance.displayName} — Stream ID
                </span>
                <div className="relative">
                  <input
                    className={FIELD}
                    value={streamIds[instance.key] || ""}
                    onChange={(e) => onStreamIdChange(instance.key, e.target.value)}
                    placeholder="12345.ts"
                    autoComplete="off"
                  />
                  {suggestions[instance.key]?.length > 0 && (
                    <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
                      {suggestions[instance.key].map((match) => (
                        <li key={match.StreamID}>
                          <button
                            type="button"
                            className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                            onClick={() => pickChannel(instance.key, match)}
                          >
                            <span className="text-slate-900 dark:text-white">
                              {match.Category ? `${match.Category} — ` : ""}
                              {match.Name}
                            </span>
                            <span className="text-xs text-slate-400">{match.StreamID}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {pickedNames[instance.key] && (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Selected: {pickedNames[instance.key]}
                  </span>
                )}
              </label>
```

- [ ] **Step 3: Manually verify**

Run: `cd web && npm run dev` (and the Suite server against at least one real or stubbed instance with `healthCheckEnabled` reachable — or temporarily point `api.healthCheckChannels` at a local `json-server`/curl-able stub returning `{ results: [{ StreamID: "1", Name: "Test Channel", Category: "Test" }] }` if no live instance is available)

Check, in the wizard's health-check step, with at least one instance toggled on:
1. Typing in the "Stream ID" field after a ~300ms pause shows a dropdown with matching channels.
2. Clicking a suggestion fills the field with its `StreamID` and shows a "Selected: Category — Name" caption underneath.
3. Typing further after picking clears the caption and re-triggers search.
4. Clearing the field removes the dropdown.
5. With the backend endpoint unreachable (stop the Suite's network to the instance, or point at a bad URL), typing still works as a plain field — no dropdown, no error shown, and "Continue" still enables once every chosen instance has a non-empty field.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/setup/StepHealthCheck.jsx
git commit -m "$(cat <<'EOF'
Wizard: search channels by name in the health-check step

The stream-ID field now suggests channels as you type (via the new
/health-check/channels route) instead of demanding the raw ID upfront.
The field stays fully manual-entry capable — a failed or empty search
just means no dropdown, never an error.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Plan self-review notes

- **Spec coverage:** data flow (Tasks 1-2), UI dropdown + category label + manual fallback (Task 3), error handling (Tasks 2-3), Suite-side testing (Tasks 1-2). The spec's stream-share-side items (new endpoint, `SearchStreamNames`, category harvesting, schema migration) belong to the companion plan in the `stream-share` repo, not this one.
- **Deviation from the spec's testing section:** the spec says to mirror "the existing VOD-search route test" — there isn't one (`/vod/search` has no dedicated test in this repo). Task 2's route test instead follows the closest real precedent, `server/test/stack-routes.test.js`'s end-to-end-over-real-HTTP pattern combined with `server/test/instance-health.test.js`'s fake-instance-server style.
- **No frontend test framework exists** in `web/` (confirmed: no test files, no test script) — Task 3 is verified manually rather than inventing a test setup for one component.
