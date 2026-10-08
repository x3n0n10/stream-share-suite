# Fully Generic DNS-Challenge Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Hetzner/Cloudflare preset picker from Caddy's DNS-challenge mode. The operator always enters the Caddy module and directive directly; the Suite auto-detects which `{env.NAME}` credentials the directive references and renders one write-only box per name.

**Architecture:** Backend: `dnsChallenge()` collapses to a single path (module + directive + parsed env, no provider branching); the catalog `ready` hook gains a check that every `{env.NAME}` the directive references has a value in `dnsEnv`. Frontend: a new `DirectiveEnvEditor` component (same shape as the existing `ErrorSlateEditor`) reads the live directive text and renders one input per detected name; `SchemaForm` gains one generic addition (passing the whole draft to a field's renderer, not just its own value) so the editor can see the directive field.

**Tech Stack:** Node (ESM) backend in `server/`, tests via `node --test`. React frontend in `web/` (Vite, Tailwind), no test framework — manual/browser verification only for Task 2.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-09-29-dns-challenge-generic-provider-design.md`. Read it if anything here is unclear.
- This amends work already on branch `claude/caddy-dns-challenge` (open PR #46, unmerged) — no back-compat/migration is needed for `dnsProvider`/`dnsApiToken`, they are deleted outright.
- Every module value anywhere (including examples in help text) must carry a pinned `@version`. This was a real production failure: `caddy add-package` without a version can build a module's unreleased branch HEAD rather than its latest tag.
- `renderCaddyfile`/`renderCaddySpec`'s output shape from `dnsChallenge()` (`directive`, `env`, `modules`, `propagationDelay`) is unchanged — do not touch `renderCaddyfile`, `renderCaddySpec`, `CADDY_START_SCRIPT`, or any non-DNS (instance/dashboard routing) behavior.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` (that exact model name, whichever model you are).
- **Committing:** plain `git commit` is blocked by a guard in this repo. Write the message to a file under `/private/tmp/claude-501/-Users-jorislankhorst-Claude/83ef7f57-0172-4320-ba0f-424f637c7b19/scratchpad/` (not in the repo), then: `git add <files>`, confirm `git diff --cached --stat` is non-empty, `TREE=$(git write-tree)`, `PARENT=$(git rev-parse HEAD)`, `SHA=$(git commit-tree "$TREE" -p "$PARENT" -F <msgfile>)`, `git update-ref refs/heads/claude/caddy-dns-challenge "$SHA"`. Re-check `git status --short` afterwards (only the untracked `.claude/settings.json` and `CLAUDE.md` may remain); the guard sometimes resets the index. Do not push.
- Run backend tests from `server/`: `node --test test/<file>` for one file, `npm test` for everything.
- The repo's CLAUDE.md mentions a graphify knowledge graph, but `graphify-out/` does not exist here; read files directly.

---

### Task 1: Backend — drop the preset table, simplify `dnsChallenge`, add the completeness check

**Files:**
- Modify (rename): `server/src/schema/dnsProviders.js` → `server/src/schema/dnsModule.js`
- Modify: `server/src/schema/caddy.js`
- Modify: `server/src/reconcile/caddy.js`
- Modify: `server/src/reconcile/catalog.js`
- Modify: `README.md`
- Test: `server/test/caddy.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `MODULE_PATH` now lives in `server/src/schema/dnsModule.js` (same regex, same export name). `dnsChallenge(values)` keeps its exact return shape. `CADDY_SCHEMA.fields` no longer has `dnsProvider` or `dnsApiToken`; `dnsModule`/`dnsDirective`/`dnsEnv` are visible whenever `tlsMode === "dns"` (previously `dnsEnv`/`dnsModule`/`dnsDirective` were custom-only). The `caddy` catalog entry's `ready(values)` gains a third failure mode (missing referenced env var), string message `` `Directive references ${missing.join(", ")} but no value is set.` ``.

- [ ] **Step 1: Rename the provider-table file to a module-only file**

Move `server/src/schema/dnsProviders.js` to `server/src/schema/dnsModule.js`. Replace its contents entirely with:

```js
// A Go package path, optionally with an @version suffix, as `caddy
// add-package` takes it. Deliberately strict: it ends up as an argument to a
// shell script, so anything with a space, quote, ;, $ or backtick is refused
// here rather than escaped later.
//
// Always pin a version. Confirmed in a real deployment: without @version,
// add-package does not necessarily build a module's latest tagged release —
// it can build its unreleased branch HEAD instead.
export const MODULE_PATH = /^[A-Za-z0-9][A-Za-z0-9._~-]*(\/[A-Za-z0-9._~-]+)+(@[A-Za-z0-9._+-]+)?$/;
```

(`DNS_PROVIDERS` and its two entries, and the file's old header comment, are gone entirely — nothing else in the codebase should define a provider table any more.)

- [ ] **Step 2: Update `server/src/schema/caddy.js`**

Remove the import `import { DNS_PROVIDERS } from "./dnsProviders.js";` and the three constants directly below it (`TABLE_IDS`, `DNS_PROVIDER_OPTIONS`, `DNS_PROVIDER_LABELS`) — delete that whole block, nothing replaces it.

Remove the `dnsProvider` field object (the `select` field with `options: DNS_PROVIDER_OPTIONS`) and the `dnsApiToken` field object entirely.

Replace the `dnsModule` field with:

```js
    {
      key: "dnsModule",
      envVar: null,
      label: "Caddy module",
      help:
        "The Go package of your provider's Caddy plugin, pinned to an exact version — e.g. " +
        "github.com/caddy-dns/hetzner@v2.0.1 or github.com/caddy-dns/cloudflare@v0.2.4. Without a pinned " +
        "version, Caddy's add-package can build the module's unreleased branch instead of its latest release. " +
        "See caddyserver.com/download for the full list of packages.",
      group: "DNS challenge",
      required: true,
      dependsOn: { key: "tlsMode", equals: "dns" },
    },
```

Replace the `dnsDirective` field with:

```js
    {
      key: "dnsDirective",
      envVar: null,
      label: "Directive",
      help:
        "Everything after `dns` in the site's tls block, e.g. `hetzner {env.HETZNER_API_TOKEN}` or " +
        "`cloudflare {env.CLOUDFLARE_API_TOKEN}`. Reference credentials as {env.NAME} — a matching box appears " +
        "below for each one, for you to fill in.",
      group: "DNS challenge",
      required: true,
      dependsOn: { key: "tlsMode", equals: "dns" },
    },
```

Replace the `dnsEnv` field with:

```js
    {
      key: "dnsEnv",
      envVar: null,
      label: "Provider environment variables",
      help: "Filled in automatically from the {env.NAME} names in Directive, above. Stored write-only and " +
        "passed to the Caddy container's environment; never written into the Caddyfile.",
      type: "directiveEnv",
      secret: true,
      group: "DNS challenge",
      dependsOn: { key: "tlsMode", equals: "dns" },
    },
```

(`dnsPropagationDelay` is untouched — its `dependsOn` was already just `{ key: "tlsMode", equals: "dns" }`.)

- [ ] **Step 3: Update `server/src/reconcile/caddy.js`**

Change the import line:

```js
import { MODULE_PATH } from "../schema/dnsModule.js";
```

Delete the line `const DNS_PROVIDER_FIELD = CADDY_SCHEMA.fields.find((f) => f.key === "dnsProvider");` (no longer exists, no longer needed — there is no default provider to fall back to).

Replace the whole `dnsChallenge` function (including its doc comment) with:

```js
// What the DNS challenge needs, resolved from the stored values: the
// directive that goes after `dns` in each site's tls block, the environment
// variables it references, the Caddy package to add (`modules`), and an
// optional propagation delay. Null when DNS mode is off or the module/
// directive is not usable.
//
// The token only ever travels in `env` (the container's environment); the
// directive refers to it as {env.NAME}, so the Caddyfile on disk never holds
// it — the operator's own dnsEnv values decide what that placeholder
// resolves to, sight unseen by this function. The directive is collapsed to
// one line so it stays one directive regardless of how it was typed. A
// propagation delay that is not a Go duration is ignored, the same way an
// unparseable URL is elsewhere in this file, rather than written into a
// Caddyfile Caddy would refuse to load.
export function dnsChallenge(values) {
  if (values.tlsMode !== "dns") return null;

  const module = String(values.dnsModule || "").trim();
  if (!MODULE_PATH.test(module)) return null;

  const directive = String(values.dnsDirective || "").replace(/\s*\n\s*/g, " ").trim();
  if (!directive) return null;

  const env = parseExtraEnv(values.dnsEnv);
  const delay = String(values.dnsPropagationDelay || "").trim();
  return { directive, env, modules: [module], propagationDelay: GO_DURATION.test(delay) ? delay : null };
}
```

Leave `GO_DURATION`, `caddyStartCommand`, `CADDY_START_SCRIPT`, `renderCaddyfile`, `renderCaddySpec`, and everything about instance/dashboard routing untouched.

- [ ] **Step 4: Update `server/src/reconcile/catalog.js`**

Change the import line:

```js
import { MODULE_PATH } from "../schema/dnsModule.js";
```

Add, next to the file's other `reconcile/` imports:

```js
import { parseExtraEnv } from "./env.js";
```

Replace the `caddy` entry's `ready` hook (and its comment) with:

```js
    // DNS mode needs a directive to write and a Caddy module to add — the
    // stock image is fine either way, since the module is added when Caddy
    // starts (see reconcile/caddy.js). It also needs a value for every
    // {env.NAME} the directive actually references: the operator can edit
    // the directive after already saving values, and a referenced name with
    // no value would apply cleanly and then fail inside the Caddy container.
    ready: (values) => {
      if (values.tlsMode !== "dns") return null;
      if (!String(values.dnsDirective || "").trim()) return "DNS challenge needs a directive.";
      if (!MODULE_PATH.test(String(values.dnsModule || "").trim())) {
        return "DNS challenge needs a Caddy module such as github.com/caddy-dns/porkbun@v1.2.3.";
      }
      const referenced = [...String(values.dnsDirective || "").matchAll(/\{env\.([A-Za-z0-9_]+)\}/g)].map(
        (m) => m[1]
      );
      const provided = new Set(Object.keys(parseExtraEnv(values.dnsEnv)));
      const missing = [...new Set(referenced)].filter((name) => !provided.has(name));
      if (missing.length > 0) return `Directive references ${missing.join(", ")} but no value is set.`;
      return null;
    },
```

- [ ] **Step 5: README**

In `README.md`'s Caddy section, find the paragraph beginning "DNS providers are Caddy plugins, and the stock `caddy:2-alpine` image has none, so the Suite adds the plugin for you..." (it names Hetzner/Cloudflare's module strings and the Custom provider). Replace the sentence listing the modules — from "for the provider's module (Hetzner ... or the **Caddy module** you enter for a Custom provider..." through the sentence ending "...pin any Custom module the same way." — with:

```markdown
for the module you give it in **Caddy module** (pinned to an exact version,
e.g. `github.com/caddy-dns/hetzner@v2.0.1` or
`github.com/caddy-dns/cloudflare@v0.2.4`), and writes the **Directive** you
give it (everything after `dns` in the site's tls block, e.g.
`hetzner {env.HETZNER_API_TOKEN}`) into the Caddyfile. Reference credentials
in the directive as `{env.NAME}` — a matching box appears in **Provider
environment variables** for each one you reference, to fill in. Without a
pinned version, `add-package` does not necessarily build the latest release —
it can build the module's unreleased branch instead, so always pin one.
```

Leave the rest of the DNS-challenge section (the "Worth knowing" bullets about caching, `add-package` being experimental, needing internet access, etc.) untouched — none of that changed.

- [ ] **Step 6: Rewrite the DNS-mode section of `server/test/caddy.test.js`**

Change the import line (currently `import { MODULE_PATH } from "../src/schema/dnsProviders.js";`) to:

```js
import { MODULE_PATH } from "../src/schema/dnsModule.js";
```

The file is 462 lines; lines 1-236 (the instance-routing and dashboard tests) are untouched. Replace everything from the line `test("dnsChallenge is null outside DNS mode", () => {` through the end of the file with:

```js
test("dnsChallenge is null outside DNS mode", () => {
  const dns = { dnsModule: "github.com/caddy-dns/hetzner@v2.0.1", dnsDirective: "hetzner {env.T}" };
  assert.equal(dnsChallenge({ tlsMode: "internal", ...dns }), null);
  assert.equal(dnsChallenge({ tlsMode: "acme", ...dns }), null);
  assert.equal(dnsChallenge({}), null);
});

test("dnsChallenge uses the typed directive collapsed to one line, the module, and the parsed env", () => {
  const challenge = dnsChallenge({
    tlsMode: "dns",
    dnsModule: "github.com/caddy-dns/porkbun@v1.2.3",
    dnsDirective: "porkbun {env.PORKBUN_API_KEY}\n {env.PORKBUN_API_SECRET_KEY}",
    dnsEnv: "PORKBUN_API_KEY=k\nPORKBUN_API_SECRET_KEY=s\n# a comment\n",
  });
  assert.equal(challenge.directive, "porkbun {env.PORKBUN_API_KEY} {env.PORKBUN_API_SECRET_KEY}");
  assert.deepEqual(challenge.env, { PORKBUN_API_KEY: "k", PORKBUN_API_SECRET_KEY: "s" });
  assert.deepEqual(challenge.modules, ["github.com/caddy-dns/porkbun@v1.2.3"]);
});

test("dnsChallenge is null when the directive or module is missing or invalid", () => {
  assert.equal(dnsChallenge({ tlsMode: "dns", dnsDirective: "  " }), null); // blank directive
  assert.equal(dnsChallenge({ tlsMode: "dns", dnsDirective: "porkbun {env.K}" }), null); // no module

  const base = { tlsMode: "dns", dnsDirective: "porkbun {env.K}" };
  assert.equal(dnsChallenge({ ...base, dnsModule: "porkbun; rm -rf /" }), null); // not a package path
  assert.notEqual(dnsChallenge({ ...base, dnsModule: "github.com/caddy-dns/porkbun@v1.2.3" }), null);
});

test("a propagation delay is kept when it is a Go duration and ignored otherwise", () => {
  const base = { tlsMode: "dns", dnsModule: "github.com/caddy-dns/hetzner@v2.0.1", dnsDirective: "hetzner {env.T}" };
  assert.equal(dnsChallenge({ ...base, dnsPropagationDelay: "30s" }).propagationDelay, "30s");
  assert.equal(dnsChallenge({ ...base, dnsPropagationDelay: "1m30s" }).propagationDelay, "1m30s");
  assert.equal(dnsChallenge({ ...base, dnsPropagationDelay: "soon" }).propagationDelay, null);
  assert.equal(dnsChallenge({ ...base, dnsPropagationDelay: "" }).propagationDelay, null);
});

test("DNS mode requires the ACME email, and the DNS fields only matter in DNS mode", () => {
  const dns = { tlsMode: "dns", dnsModule: "github.com/caddy-dns/hetzner@v2.0.1", dnsDirective: "hetzner {env.T}" };
  assert.ok(validate(CADDY_SCHEMA, dns).some((e) => e.key === "acmeEmail"));
  assert.deepEqual(validate(CADDY_SCHEMA, { ...dns, acmeEmail: "a@example.com" }), []);

  // Nothing DNS-related is required, or even visible, in the other modes.
  assert.deepEqual(validate(CADDY_SCHEMA, { tlsMode: "internal" }), []);
  assert.deepEqual(validate(CADDY_SCHEMA, { tlsMode: "acme", acmeEmail: "a@example.com" }), []);
});

test("DNS mode needs a directive and a module, always", () => {
  const email = { tlsMode: "dns", acmeEmail: "a@example.com" };
  const errors = validate(CADDY_SCHEMA, email);
  assert.ok(errors.some((e) => e.key === "dnsDirective"));
  assert.ok(errors.some((e) => e.key === "dnsModule"));
  assert.deepEqual(
    validate(CADDY_SCHEMA, {
      ...email,
      dnsDirective: "porkbun {env.K}",
      dnsModule: "github.com/caddy-dns/porkbun@v1.2.3",
    }),
    []
  );
});

test("dnsProvider and dnsApiToken no longer exist on the schema", () => {
  const keys = CADDY_SCHEMA.fields.map((f) => f.key);
  assert.equal(keys.includes("dnsProvider"), false);
  assert.equal(keys.includes("dnsApiToken"), false);
});

const DNS = {
  tlsMode: "dns",
  acmeEmail: "admin@example.com",
  dnsModule: "github.com/caddy-dns/hetzner@v2.0.1",
  dnsDirective: "hetzner {env.HETZNER_API_TOKEN}",
  dnsEnv: "HETZNER_API_TOKEN=secret-token",
};

test("DNS mode writes the global email and a tls { dns ... } block per site, never tls internal", () => {
  provisionInstance(PROVIDER("Provider 1", null, "https://tv.example.com/p1"));
  const file = renderCaddyfile(DNS);
  assert.match(file, /email admin@example\.com/);
  assert.match(file, /tv\.example\.com \{\n\ttls \{\n\t\tdns hetzner \{env\.HETZNER_API_TOKEN\}\n\t\}\n/);
  assert.equal(file.includes("tls internal"), false);
});

test("the DNS tls block appears in every site block, the dashboard's included", () => {
  provisionInstance(PROVIDER("Provider 1", null, "https://tv.example.com/p1"));
  const file = renderCaddyfile(
    { ...DNS, dashboardUrl: "https://suite.example.com" },
    "http://stream-share-suite:3000"
  );
  assert.equal(file.match(/\ttls \{/g).length, 2);
});

test("propagation_delay is written only when set, inside the same tls block", () => {
  provisionInstance(PROVIDER("Provider 1", null, "https://tv.example.com/p1"));

  const withDelay = renderCaddyfile({ ...DNS, dnsPropagationDelay: "30s" });
  assert.match(withDelay, /\t\tdns hetzner \{env\.HETZNER_API_TOKEN\}\n\t\tpropagation_delay 30s\n\t\}/);

  assert.equal(renderCaddyfile(DNS).includes("propagation_delay"), false);
});

test("the Caddyfile never contains the token, only the env placeholder", () => {
  provisionInstance(PROVIDER("Provider 1", null, "https://tv.example.com/p1"));
  const file = renderCaddyfile(DNS);
  assert.equal(file.includes("secret-token"), false);
  assert.match(file, /\{env\.HETZNER_API_TOKEN\}/);
});

test("a directive is written as typed", () => {
  provisionInstance(PROVIDER("Provider 1", null, "https://tv.example.com/p1"));
  const file = renderCaddyfile({
    tlsMode: "dns",
    acmeEmail: "admin@example.com",
    dnsDirective: "porkbun {env.PORKBUN_API_KEY} {env.PORKBUN_API_SECRET_KEY}",
    dnsModule: "github.com/caddy-dns/porkbun@v1.2.3",
  });
  assert.match(file, /\t\tdns porkbun \{env\.PORKBUN_API_KEY\} \{env\.PORKBUN_API_SECRET_KEY\}\n/);
});

test("renderCaddySpec carries the token in env and the spec hash moves with it", async () => {
  const spec = await renderCaddySpec(DNS);
  assert.equal(spec.env.HETZNER_API_TOKEN, "secret-token");
  assert.ok(spec.env.CADDY_CONFIG_HASH);

  const other = await renderCaddySpec({ ...DNS, dnsEnv: "HETZNER_API_TOKEN=another-token" });
  assert.notEqual(computeSpecHash(spec), computeSpecHash(other));
});

test("the env reaches the container, and CADDY_CONFIG_HASH cannot be overridden by it", async () => {
  const spec = await renderCaddySpec({
    tlsMode: "dns",
    acmeEmail: "admin@example.com",
    dnsDirective: "porkbun {env.PORKBUN_API_KEY}",
    dnsModule: "github.com/caddy-dns/porkbun@v1.2.3",
    dnsEnv: "PORKBUN_API_KEY=k\nCADDY_CONFIG_HASH=spoofed",
  });
  assert.equal(spec.env.PORKBUN_API_KEY, "k");
  assert.notEqual(spec.env.CADDY_CONFIG_HASH, "spoofed");
});

test("outside DNS mode the container env is just the config hash", async () => {
  assert.deepEqual(Object.keys((await renderCaddySpec({})).env), ["CADDY_CONFIG_HASH"]);
  assert.deepEqual(Object.keys((await renderCaddySpec({ tlsMode: "acme", acmeEmail: "a@example.com" })).env), [
    "CADDY_CONFIG_HASH",
  ]);
});

test("MODULE_PATH accepts Go package paths (with an optional version) and rejects anything shell-shaped", () => {
  for (const ok of [
    "github.com/caddy-dns/hetzner/v2",
    "github.com/caddy-dns/porkbun",
    "github.com/caddy-dns/porkbun@v1.2.3",
  ]) {
    assert.ok(MODULE_PATH.test(ok), ok);
  }
  for (const bad of [
    "",
    "porkbun",
    "github.com/a b/c",
    "github.com/x/y;rm -rf /",
    "github.com/x/$(id)",
    "github.com/x/`id`",
    'github.com/x/"y"',
    "github.com/x/y@v1 ; id",
  ]) {
    assert.equal(MODULE_PATH.test(bad), false, JSON.stringify(bad));
  }
});

test("in DNS mode the container command adds the configured module, and the spec hash moves when it changes", async () => {
  const hetzner = await renderCaddySpec(DNS);
  assert.deepEqual(hetzner.command, ["sh", "-c", CADDY_START_SCRIPT, "sh", "github.com/caddy-dns/hetzner@v2.0.1"]);

  const base = { tlsMode: "dns", acmeEmail: "admin@example.com", dnsDirective: "porkbun {env.PORKBUN_API_KEY}" };
  const plain = await renderCaddySpec({ ...base, dnsModule: "github.com/caddy-dns/porkbun" });
  const pinned = await renderCaddySpec({ ...base, dnsModule: "github.com/caddy-dns/porkbun@v1.2.3" });
  assert.deepEqual(plain.command.slice(4), ["github.com/caddy-dns/porkbun"]);
  assert.notEqual(computeSpecHash(plain), computeSpecHash(pinned));
});

test("outside DNS mode the container has no command override", async () => {
  assert.equal("command" in (await renderCaddySpec({})), false);
  assert.equal("command" in (await renderCaddySpec({ tlsMode: "acme", acmeEmail: "a@example.com" })), false);
});

test("the image is never checked for readiness", () => {
  const entry = getCatalogEntry("caddy");
  const dns = {
    tlsMode: "dns",
    dnsDirective: "hetzner {env.T}",
    dnsModule: "github.com/caddy-dns/hetzner@v2.0.1",
    dnsEnv: "T=x",
  };
  assert.equal(entry.ready({ ...dns, image: "caddy:2-alpine" }), null);
  assert.equal(entry.ready({ ...dns, image: "" }), null);
  assert.equal(entry.ready({ tlsMode: "acme" }), null);
  assert.equal(entry.ready({}), null);
});

test("DNS mode needs a directive and a valid module to be ready", () => {
  const entry = getCatalogEntry("caddy");
  assert.match(
    entry.ready({ tlsMode: "dns", dnsDirective: "   ", dnsModule: "github.com/caddy-dns/porkbun@v1.2.3" }),
    /needs a directive/
  );
  assert.match(entry.ready({ tlsMode: "dns", dnsDirective: "porkbun {env.K}" }), /needs a Caddy module/);
  assert.match(
    entry.ready({ tlsMode: "dns", dnsDirective: "porkbun {env.K}", dnsModule: "porkbun; id" }),
    /needs a Caddy module/
  );
});

test("DNS mode is not ready when the directive references a variable dnsEnv does not supply", () => {
  const entry = getCatalogEntry("caddy");
  const base = { tlsMode: "dns", dnsModule: "github.com/caddy-dns/hetzner@v2.0.1" };
  assert.match(
    entry.ready({ ...base, dnsDirective: "hetzner {env.HETZNER_API_TOKEN}" }),
    /Directive references HETZNER_API_TOKEN but no value is set/
  );
  assert.match(
    entry.ready({ ...base, dnsDirective: "porkbun {env.A} {env.B}", dnsEnv: "A=x" }),
    /Directive references B but no value is set/
  );
  assert.equal(
    entry.ready({ ...base, dnsDirective: "hetzner {env.HETZNER_API_TOKEN}", dnsEnv: "HETZNER_API_TOKEN=tok" }),
    null
  );
});

test("DNS mode is ready when the directive references no {env.*} names at all", () => {
  const entry = getCatalogEntry("caddy");
  assert.equal(
    entry.ready({
      tlsMode: "dns",
      dnsDirective: "hetzner literal-token",
      dnsModule: "github.com/caddy-dns/hetzner@v2.0.1",
    }),
    null
  );
});
```

- [ ] **Step 7: Run the tests**

Run: `cd server && node --test test/caddy.test.js`
Expected: PASS, every test in the file.

Then the whole suite: `cd server && npm test`
Expected: all tests pass. (Note: `server/test/caddy-start-script.test.js` needs no changes — it tests `CADDY_START_SCRIPT` directly with arbitrary module strings, unrelated to the provider table.)

- [ ] **Step 8: Commit**

Message: `Replace the DNS-provider preset table with a plain module and directive`

Files: `server/src/schema/dnsModule.js` (new), `server/src/schema/dnsProviders.js` (deleted — use `git add -A` or explicitly stage the rename/deletion), `server/src/schema/caddy.js`, `server/src/reconcile/caddy.js`, `server/src/reconcile/catalog.js`, `README.md`, `server/test/caddy.test.js`

---

### Task 2: Frontend — auto-detected environment variable boxes

**Files:**
- Create: `web/src/components/DirectiveEnvEditor.jsx`
- Modify: `web/src/components/SchemaForm.jsx`

**Interfaces:**
- Consumes: nothing new from the backend — `dnsEnv`'s stored shape (`KEY=VALUE` lines) is unchanged from Task 1.
- Produces: `export default function DirectiveEnvEditor({ value, directive, onChange })`. `SchemaForm`'s field renderer gains the current `draft` as a parameter, threaded to every field type (only this one uses it).

- [ ] **Step 1: Add `draft` to `renderControl`/`FieldInput`**

In `web/src/components/SchemaForm.jsx`, both call sites of `<FieldInput ... />` (the "basic" fields grid and the "Advanced" fields grid) pass `draft={draft}` alongside their existing props:

```jsx
                <FieldInput
                  key={field.key}
                  field={field}
                  value={draft[field.key]}
                  onChange={set}
                  extra={
                    typeof extraOptions?.[field.key] === "function"
                      ? extraOptions[field.key](draft, set)
                      : extraOptions?.[field.key]
                  }
                  componentKey={componentKey}
                  draft={draft}
                />
```

and, in the Advanced block:

```jsx
                    <FieldInput
                      key={field.key}
                      field={field}
                      value={draft[field.key]}
                      onChange={set}
                      componentKey={componentKey}
                      draft={draft}
                    />
```

Change `FieldInput`'s signature from `function FieldInput({ field, value, onChange, extra, componentKey }) {` to `function FieldInput({ field, value, onChange, extra, componentKey, draft }) {`, and its call to `renderControl(field, value, onChange, extra, componentKey)` to `renderControl(field, value, onChange, extra, componentKey, draft)`.

Change `renderControl`'s signature from `function renderControl(field, value, onChange, extra, componentKey) {` to `function renderControl(field, value, onChange, extra, componentKey, draft) {`. Every existing branch inside it (`textarea`, `errorSlates`, `checkbox`, `combobox`, `channelSearch`, `select`, the default text/password input) is otherwise unchanged — they simply don't use the new parameter.

- [ ] **Step 2: Wire up the new field type**

Add the import near the top of `SchemaForm.jsx`, alongside the other field-specific component imports:

```js
import DirectiveEnvEditor from "./DirectiveEnvEditor.jsx";
```

Add a branch to `renderControl`, next to the existing `if (field.type === "errorSlates")` branch:

```js
  if (field.type === "directiveEnv") {
    return <DirectiveEnvEditor value={value} directive={draft?.dnsDirective} onChange={(next) => onChange(field.key, next)} />;
  }
```

Add `"directiveEnv"` to the `multiControl` set (so it renders in a plain `<div>` wrapper, the same treatment `errorSlates` gets, since this field is a whole editor rather than one input):

```js
  const multiControl =
    field.type === "select" ||
    field.type === "errorSlates" ||
    field.type === "directiveEnv" ||
    field.type === "combobox" ||
    field.type === "channelSearch";
```

Add `field.type === "directiveEnv"` to the full-width (`sm:col-span-2`) condition in the same file (the line reading `field.type === "textarea" || field.type === "checkbox" || multiControl ? "sm:col-span-2" : ""`) — no change needed there since `multiControl` already covers it once added above; just confirm that condition reads `multiControl` (it does) so no separate edit is required.

- [ ] **Step 3: Write `DirectiveEnvEditor.jsx`**

Create `web/src/components/DirectiveEnvEditor.jsx`:

```jsx
import { useMemo } from "react";
import { FIELD } from "./common.jsx";

// One write-only box per {env.NAME} the current directive references,
// instead of a free-text KEY=VALUE textarea — the same idea as
// ErrorSlateEditor: a structured editor over one field's plain-string value.
//
// `value` is this field's own draft value (KEY=VALUE lines) — like any other
// secret field it arrives as "" whenever the form doesn't already hold an
// unsaved edit, because a secret's stored content is never sent back to the
// browser (see registry.js's toPublicFields). So there is no per-name
// "already set" state to show here; the field-level hint above this editor
// (rendered by FieldInput, from field.valueSet) already covers that at the
// whole-value granularity every other secret field uses.
//
// `directive` is the live sibling field's value, threaded down through
// SchemaForm's draft — this editor has no server round-trip of its own.

const ENV_REF = /\{env\.([A-Za-z0-9_]+)\}/g;

function parseValue(raw) {
  const values = {};
  for (const line of String(raw || "").split("\n")) {
    const idx = line.indexOf("=");
    if (idx > 0) values[line.slice(0, idx).trim()] = line.slice(idx + 1);
  }
  return values;
}

function detectNames(directive) {
  return [...new Set([...String(directive || "").matchAll(ENV_REF)].map((m) => m[1]))];
}

export default function DirectiveEnvEditor({ value, directive, onChange }) {
  const names = useMemo(() => detectNames(directive), [directive]);
  const values = useMemo(() => parseValue(value), [value]);

  function setName(name, next) {
    // Only currently-referenced names are ever written back — editing the
    // directive to drop a name drops its value on the very next keystroke
    // here, rather than leaving an orphaned credential in storage.
    const merged = { ...values, [name]: next };
    onChange(names.map((n) => `${n}=${merged[n] ?? ""}`).join("\n"));
  }

  if (names.length === 0) {
    return (
      <p className="text-xs text-slate-400 dark:text-slate-500">
        Reference a credential in Directive above as {"{env.NAME}"} to get a box for it here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {names.map((name) => (
        <label key={name} className="flex flex-col gap-1">
          <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{name}</span>
          <input
            className={FIELD}
            type="password"
            autoComplete="new-password"
            value={values[name] ?? ""}
            onChange={(e) => setName(name, e.target.value)}
          />
        </label>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Manual verification**

`web/` has no test framework — verify in the browser:

1. Start the dev server and sign in.
2. Open Stack → Components → Caddy, switch HTTPS to "Automatic (DNS challenge)".
3. Confirm **Caddy module** and **Directive** are both visible immediately (not gated behind a provider picker — there is no provider picker at all).
4. Type `hetzner {env.HETZNER_API_TOKEN}` into Directive. Confirm a single box labelled `HETZNER_API_TOKEN` appears under "Provider environment variables".
5. Type a value into that box, then edit the directive to add a second reference, e.g. `hetzner {env.HETZNER_API_TOKEN} {env.HETZNER_ZONE}`. Confirm a second box labelled `HETZNER_ZONE` appears and the first box's typed value is still there.
6. Remove `{env.HETZNER_API_TOKEN}` from the directive, leaving only `{env.HETZNER_ZONE}`. Confirm the `HETZNER_API_TOKEN` box disappears.
7. Clear the directive entirely. Confirm the placeholder note appears ("Reference a credential...") and no boxes remain.
8. Save with a directive referencing a name with no value typed in its box; confirm the Stack page's plan shows Caddy as incomplete with the "Directive references ... but no value is set" message (from Task 1's `ready` hook).
9. Confirm no console errors during any of the above.

- [ ] **Step 5: Commit**

Message: `Auto-detect DNS-challenge environment variables from the directive`

Files: `web/src/components/DirectiveEnvEditor.jsx`, `web/src/components/SchemaForm.jsx`
