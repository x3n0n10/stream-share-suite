# Caddy DNS Plugins via `add-package` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DNS-challenge mode work on the stock `caddy:2-alpine` image by having the Suite add the DNS provider's plugin when Caddy starts (`caddy add-package`), instead of requiring an operator-built image, and let a custom provider name its own Caddy module.

**Architecture:** Container specs gain an optional `command` (Docker `Cmd`), included in the spec hash only when set. In DNS mode the Caddy spec's command is `["sh", "-c", CADDY_START_SCRIPT, "sh", ...modules]`: the script skips modules the binary already has, runs `caddy add-package` for the rest, then `exec`s Caddy. `dnsChallenge()` gains `modules` (from the provider table, or a validated custom `dnsModule`). The "incomplete on the stock image" guard is replaced by custom-provider checks.

**Tech Stack:** Node (ESM), `node --test`, Express backend in `server/`. POSIX `sh` script tested with a stub `caddy` binary. No frontend change.

## Global Constraints

- This amends work already on this branch (`claude/caddy-dns-challenge`, PR #46, unmerged): the DNS mode, provider table, schema fields, `dnsChallenge()`, per-site `tls { dns ... }` rendering and env-only token handling all stay. Design spec (already updated for this change): `docs/superpowers/specs/2026-09-28-caddy-dns-challenge-design.md`. Read it if anything here is unclear.
- The stock `caddy:2-alpine` image stays the default and must work in DNS mode. Do not build, publish or default to any plugin image, and do not add `CADDY_MODULES`, `XDG_*` or Go-cache env vars.
- Module text must never be interpolated into shell source: modules are positional arguments (`"$@"`) to the script. Custom module paths must pass `MODULE_PATH` or `dnsChallenge()` returns `null`.
- The token only ever travels in the container env; the Caddyfile never contains it (unchanged).
- `tlsMode` `internal` and `acme` output, container env and spec hash must stay unchanged, and the container spec must have no `command` outside DNS mode. All pre-existing tests keep passing, except the specific tests this plan says to change (their behaviour is intentionally replaced).
- Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` (that exact model name, whichever model you are).
- **Committing:** plain `git commit` is blocked by a guard in this repo. Write the message to a file under `/private/tmp/claude-501/-Users-jorislankhorst-Claude/83ef7f57-0172-4320-ba0f-424f637c7b19/scratchpad/` (not in the repo), then: `git add <files>`, confirm `git diff --cached --stat` is non-empty, `TREE=$(git write-tree)`, `PARENT=$(git rev-parse HEAD)`, `SHA=$(git commit-tree "$TREE" -p "$PARENT" -F <msgfile>)`, `git update-ref refs/heads/claude/caddy-dns-challenge "$SHA"`. Re-check `git status --short` afterwards (only the untracked `.claude/settings.json` and `CLAUDE.md` may remain); the guard sometimes resets the index. Do not push.
- Run backend tests from `server/`: `node --test test/<file>` for one file, `npm test` for everything.
- The repo's CLAUDE.md mentions a graphify knowledge graph, but `graphify-out/` does not exist here; read files directly.

---

### Task 1: `command` support in container specs

**Files:**
- Modify: `server/src/docker/spec.js`
- Test: `server/test/spec.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `spec.command` (array of strings, optional). `computeSpecHash` includes it, in order, only when non-empty. `toCreatePayload` emits `Cmd` only when non-empty.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/spec.test.js` (it already has `BASE`, `computeSpecHash`, `toCreatePayload`):

```js
// --- command override --------------------------------------------------------

test("a spec with no command hashes the same as before the field existed", () => {
  const hash = computeSpecHash(BASE);
  assert.equal(computeSpecHash({ ...BASE, command: [] }), hash);
  assert.equal(computeSpecHash({ ...BASE, command: undefined }), hash);
});

test("setting a command changes the hash, and the order of its arguments matters", () => {
  const first = computeSpecHash({ ...BASE, command: ["sh", "-c", "x"] });
  assert.notEqual(first, computeSpecHash(BASE));
  assert.notEqual(first, computeSpecHash({ ...BASE, command: ["-c", "sh", "x"] }));
  assert.equal(first, computeSpecHash({ ...BASE, command: ["sh", "-c", "x"] }));
});

test("command becomes Cmd on the create payload, and only when set", () => {
  assert.deepEqual(toCreatePayload({ ...BASE, command: ["sh", "-c", "x"] }).Cmd, ["sh", "-c", "x"]);
  assert.equal("Cmd" in toCreatePayload(BASE), false);
  assert.equal("Cmd" in toCreatePayload({ ...BASE, command: [] }), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && node --test test/spec.test.js`
Expected: "setting a command changes the hash..." and "command becomes Cmd..." FAIL; "a spec with no command hashes the same..." already passes (it pins existing behaviour); all pre-existing tests PASS.

- [ ] **Step 3: Implement**

In `server/src/docker/spec.js`:

In `computeSpecHash`, directly after `if (spec.user) canonical.user = spec.user;`, add:

```js
  // Order is significant for a command, unlike the sorted lists above. Omitted
  // when empty, like every optional field, so no existing spec's hash moves.
  if ((spec.command || []).length > 0) canonical.command = [...spec.command];
```

In `toCreatePayload`, directly after the `payload` object literal is built (before the `if (ports.length > 0)` block), add:

```js
  // Overrides the image's own CMD. Only ever set by a renderer that has a
  // reason to (Caddy's DNS-challenge start script), never from operator text.
  if ((spec.command || []).length > 0) payload.Cmd = [...spec.command];
```

In the spec-shape comment above `computeSpecHash`, add `command: [...args]` (optional override of the image's CMD) to the listed fields.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && node --test test/spec.test.js`
Expected: PASS, all tests in the file.

Then the whole suite: `cd server && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

Message: `Let container specs override the image's command`

Files: `server/src/docker/spec.js`, `server/test/spec.test.js`

---

### Task 2: Add DNS plugins at start, custom module field, guard, docs

**Files:**
- Modify: `server/src/schema/dnsProviders.js`
- Modify: `server/src/schema/caddy.js`
- Modify: `server/src/reconcile/caddy.js`
- Modify: `server/src/reconcile/catalog.js`
- Modify: `README.md`
- Modify: `server/test/caddy.test.js`
- Create: `server/test/caddy-start-script.test.js`

**Interfaces:**
- Consumes: `spec.command` support from Task 1. Existing `dnsChallenge()`, `renderCaddySpec()`, the `ready` hook on the `caddy` catalog entry.
- Produces:
  - `export const MODULE_PATH` (`schema/dnsProviders.js`): regex for a Go package path with optional `@version`.
  - Schema field `dnsModule`.
  - `dnsChallenge(values)` now returns `{ directive, env, modules: string[], propagationDelay }` (or `null`).
  - `export const CADDY_START_SCRIPT` (string) and `spec.command` in `renderCaddySpec()` output during DNS mode.

- [ ] **Step 1: Write the failing tests**

**A. `server/test/caddy-start-script.test.js` (new file):**

```js
// The DNS-challenge start script, run for real under sh against a stand-in for
// the caddy binary: which packages it adds, which it leaves alone, and that it
// never starts Caddy when adding fails.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CADDY_START_SCRIPT } from "../src/reconcile/caddy.js";

// `list-modules --packages` prints whatever is in $STUB_DIR/packages;
// `add-package` records its arguments in $STUB_DIR/log and installs them
// (unless STUB_FAIL_ADD is set); `run` records that Caddy was started.
const STUB = `#!/bin/sh
case "$1" in
  list-modules) cat "$STUB_DIR/packages" ;;
  add-package)
    shift
    echo "add-package $*" >> "$STUB_DIR/log"
    [ -n "$STUB_FAIL_ADD" ] && exit 1
    for p in "$@"; do echo "\${p%@*}" >> "$STUB_DIR/packages"; done
    ;;
  run)
    shift
    echo "run $*" >> "$STUB_DIR/log"
    ;;
esac
`;

const RUN = "run --config /etc/caddy/Caddyfile --adapter caddyfile";

let dir;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "caddy-start-"));
  writeFileSync(path.join(dir, "caddy"), STUB);
  chmodSync(path.join(dir, "caddy"), 0o755);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function start(modules, { installed = [], failAdd = false } = {}) {
  writeFileSync(path.join(dir, "packages"), installed.map((p) => `${p}\n`).join(""));
  const result = spawnSync("sh", ["-c", CADDY_START_SCRIPT, "sh", ...modules], {
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      STUB_DIR: dir,
      ...(failAdd ? { STUB_FAIL_ADD: "1" } : {}),
    },
    encoding: "utf8",
  });
  const logPath = path.join(dir, "log");
  return {
    status: result.status,
    stderr: result.stderr,
    log: existsSync(logPath) ? readFileSync(logPath, "utf8").trim().split("\n") : [],
  };
}

test("a module the binary already has is not added, and Caddy starts", () => {
  const result = start(["github.com/caddy-dns/hetzner/v2"], {
    installed: ["dns.providers.hetzner github.com/caddy-dns/hetzner/v2"],
  });
  assert.equal(result.status, 0);
  assert.deepEqual(result.log, [RUN]);
});

test("a missing module is added, then Caddy starts", () => {
  const result = start(["github.com/caddy-dns/hetzner/v2"]);
  assert.equal(result.status, 0);
  assert.deepEqual(result.log, ["add-package github.com/caddy-dns/hetzner/v2", RUN]);
});

test("with several modules, only the missing ones are added, in one call", () => {
  const result = start(["github.com/caddy-dns/cloudflare", "github.com/caddy-dns/porkbun"], {
    installed: ["dns.providers.cloudflare github.com/caddy-dns/cloudflare"],
  });
  assert.deepEqual(result.log, ["add-package github.com/caddy-dns/porkbun", RUN]);
});

test("a version suffix is ignored for the presence check but passed to add-package", () => {
  const present = start(["github.com/caddy-dns/porkbun@v1.2.3"], { installed: ["github.com/caddy-dns/porkbun"] });
  assert.deepEqual(present.log, [RUN]);

  const missing = start(["github.com/caddy-dns/porkbun@v1.2.3"]);
  assert.deepEqual(missing.log, ["add-package github.com/caddy-dns/porkbun@v1.2.3", RUN]);
});

test("the presence check matches whole package paths, not prefixes", () => {
  const result = start(["github.com/caddy-dns/hetzner/v2"], { installed: ["github.com/caddy-dns/hetzner"] });
  assert.deepEqual(result.log, ["add-package github.com/caddy-dns/hetzner/v2", RUN]);
});

test("when add-package fails the script exits non-zero and never starts Caddy", () => {
  const result = start(["github.com/caddy-dns/hetzner/v2"], { failAdd: true });
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.log, ["add-package github.com/caddy-dns/hetzner/v2"]);
  assert.match(result.stderr, /caddy add-package failed/);
});
```

**B. `server/test/caddy.test.js`.** Add to the imports at the top:

```js
import { MODULE_PATH } from "../src/schema/dnsProviders.js";
```

and change the caddy.js import line to also import `CADDY_START_SCRIPT`:

```js
import { renderCaddyfile, renderCaddySpec, caddyContainerName, dnsChallenge, CADDY_START_SCRIPT } from "../src/reconcile/caddy.js";
```

Change these EXISTING tests (their behaviour is intentionally replaced or extended; keep their names except where noted):

1. "a table provider yields its directive and its token env var": add `modules: ["github.com/caddy-dns/hetzner/v2"],` to the expected object of the Hetzner `deepEqual`, and after the Cloudflare assertions add `assert.deepEqual(cloudflare.modules, ["github.com/caddy-dns/cloudflare"]);`.
2. "a custom provider uses the typed directive on one line and the parsed env": add `dnsModule: "github.com/caddy-dns/porkbun",` to the input values, and add `assert.deepEqual(challenge.modules, ["github.com/caddy-dns/porkbun"]);`.
3. "dnsChallenge is null when the token or custom directive is missing, or the provider is unknown": add these assertions inside it:
   ```js
   const custom = { tlsMode: "dns", dnsProvider: "custom", dnsDirective: "porkbun {env.K}" };
   assert.equal(dnsChallenge(custom), null); // no module
   assert.equal(dnsChallenge({ ...custom, dnsModule: "porkbun; rm -rf /" }), null); // not a package path
   assert.notEqual(dnsChallenge({ ...custom, dnsModule: "github.com/caddy-dns/porkbun" }), null);
   ```
4. "a table provider needs its token; a custom provider needs its directive but not a token": rename to "a table provider needs its token; a custom provider needs its directive and module but not a token", add `assert.ok(custom.some((e) => e.key === "dnsModule"));` after the `dnsDirective` assertion, and change the final `deepEqual` input to `{ ...email, dnsProvider: "custom", dnsDirective: "porkbun {env.K}", dnsModule: "github.com/caddy-dns/porkbun" }`.
5. "a custom provider's directive is written as typed" (renderCaddyfile): add `dnsModule: "github.com/caddy-dns/porkbun",` to the values (without a module the challenge is now `null` and no tls block is written).
6. "a custom provider's env reaches the container, and CADDY_CONFIG_HASH cannot be overridden by it": add `dnsModule: "github.com/caddy-dns/porkbun",` to the values (same reason).
7. DELETE the two tests "DNS mode on the stock Caddy image is flagged as not ready; a custom image or another mode is fine" and "a custom DNS provider with a blank directive is flagged as not ready" (replaced by the ready tests below).

Append these new tests to the end of the file:

```js
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

test("in DNS mode the container command adds the provider's module, and the spec hash moves when it changes", async () => {
  const hetzner = await renderCaddySpec(DNS);
  assert.deepEqual(hetzner.command, ["sh", "-c", CADDY_START_SCRIPT, "sh", "github.com/caddy-dns/hetzner/v2"]);

  const custom = {
    tlsMode: "dns",
    acmeEmail: "admin@example.com",
    dnsProvider: "custom",
    dnsDirective: "porkbun {env.PORKBUN_API_KEY}",
    dnsModule: "github.com/caddy-dns/porkbun",
  };
  const plain = await renderCaddySpec(custom);
  const pinned = await renderCaddySpec({ ...custom, dnsModule: "github.com/caddy-dns/porkbun@v1.2.3" });
  assert.deepEqual(plain.command.slice(4), ["github.com/caddy-dns/porkbun"]);
  assert.notEqual(computeSpecHash(plain), computeSpecHash(pinned));
});

test("outside DNS mode the container has no command override", async () => {
  assert.equal("command" in (await renderCaddySpec({})), false);
  assert.equal("command" in (await renderCaddySpec({ tlsMode: "acme", acmeEmail: "a@example.com" })), false);
});

test("DNS mode no longer cares which image is used", () => {
  const entry = getCatalogEntry("caddy");
  assert.equal(entry.ready({ tlsMode: "dns" }), null);
  assert.equal(entry.ready({ tlsMode: "dns", image: "caddy:2-alpine" }), null);
  assert.equal(entry.ready({ tlsMode: "acme" }), null);
  assert.equal(entry.ready({}), null);
});

test("a custom DNS provider needs a directive and a valid module to be ready", () => {
  const entry = getCatalogEntry("caddy");
  const base = { tlsMode: "dns", dnsProvider: "custom" };
  assert.match(entry.ready({ ...base, dnsDirective: "   ", dnsModule: "github.com/caddy-dns/porkbun" }), /needs a directive/);
  assert.match(entry.ready({ ...base, dnsDirective: "porkbun {env.K}" }), /needs a Caddy module/);
  assert.match(entry.ready({ ...base, dnsDirective: "porkbun {env.K}", dnsModule: "porkbun; id" }), /needs a Caddy module/);
  assert.equal(entry.ready({ ...base, dnsDirective: "porkbun {env.K}", dnsModule: "github.com/caddy-dns/porkbun" }), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && node --test test/caddy.test.js test/caddy-start-script.test.js`
Expected: FAIL. `MODULE_PATH` and `CADDY_START_SCRIPT` are not exported, so both files fail on import until Step 3.

- [ ] **Step 3: Implement `MODULE_PATH` in `schema/dnsProviders.js`**

Append to `server/src/schema/dnsProviders.js`:

```js
// A Go package path, optionally with an @version suffix, as `caddy
// add-package` takes it. Deliberately strict: it ends up as an argument to a
// shell script, so anything with a space, quote, ;, $ or backtick is refused
// here rather than escaped later.
export const MODULE_PATH = /^[A-Za-z0-9][A-Za-z0-9._~-]*(\/[A-Za-z0-9._~-]+)+(@[A-Za-z0-9._+-]+)?$/;
```

Also update the file's header comment: `module` is now what the Suite adds to Caddy when it starts (not only documentation).

- [ ] **Step 4: Update `schema/caddy.js`**

- Remove the now-unused `DNS_MODULES` constant.
- `tlsMode` help: replace the final clause `"...so no inbound ports are needed — but it needs a Caddy image that includes your provider's plugin (see Image, below)."` with `"...so no inbound ports are needed. Caddy adds your provider's plugin itself when it starts."`
- `dnsProvider` help becomes:
  ```js
      help:
        "The DNS service your domain is hosted on. Caddy adds the provider's plugin itself when it starts. " +
        "Not listed? Pick Custom and give its Caddy module. The API token below is stored write-only and " +
        "never written into the Caddyfile. Switching provider? Enter that provider's token again.",
  ```
- Insert this field after `dnsApiToken` and before `dnsDirective`:
  ```js
    {
      key: "dnsModule",
      envVar: null,
      label: "Caddy module",
      help:
        "The Go package of your provider's Caddy plugin, e.g. github.com/caddy-dns/porkbun (an @version suffix " +
        "such as @v1.2.3 is allowed). Caddy downloads it when it starts; see caddyserver.com/download for the list.",
      group: "DNS challenge",
      required: true,
      dependsOn: [
        { key: "tlsMode", equals: "dns" },
        { key: "dnsProvider", equals: "custom" },
      ],
    },
  ```
- `image` help becomes: `"Any Caddy 2 tag. In DNS-challenge mode Caddy adds your provider's plugin itself on start; an image that already includes it skips the download."`

- [ ] **Step 5: Implement in `reconcile/caddy.js`**

Change the `dnsProviders.js` import to `import { DNS_PROVIDERS, MODULE_PATH } from "../schema/dnsProviders.js";`.

In `dnsChallenge`, the table-provider branch also sets `modules`, and the custom branch validates the module. Replace the `let directive; let env;` declaration and the `if (provider) {...} else if (providerId === "custom") {...} else {...}` chain with:

```js
  let directive;
  let env;
  let modules;
  if (provider) {
    if (!values.dnsApiToken) return null;
    directive = provider.directive;
    env = { [provider.tokenEnv]: values.dnsApiToken };
    modules = [provider.module];
  } else if (providerId === "custom") {
    directive = String(values.dnsDirective || "").replace(/\s*\n\s*/g, " ").trim();
    if (!directive) return null;
    const module = String(values.dnsModule || "").trim();
    if (!MODULE_PATH.test(module)) return null;
    env = parseExtraEnv(values.dnsEnv);
    modules = [module];
  } else {
    return null;
  }
```

and the return becomes `return { directive, env, modules, propagationDelay: GO_DURATION.test(delay) ? delay : null };`. Update its doc comment to mention `modules` (the Caddy packages to add).

Add, after `dnsChallenge` (before `renderCaddyfile`'s comment):

```js
// What runs as the Caddy container's command in DNS-challenge mode. The stock
// image has no DNS provider plugins, so this adds the missing ones with
// Caddy's own `add-package` (which swaps the binary on disk for a build from
// Caddy's download service that has them) and then starts Caddy exactly as the
// image would. Modules are positional arguments, never interpolated into the
// script, and are skipped when the binary already has them — so a restart, or
// an image that ships the plugin, does not download anything. If adding fails
// the container exits with the reason in its log rather than starting Caddy
// without the plugin; Docker's restart policy retries.
export const CADDY_START_SCRIPT = `missing=""
for m in "$@"; do
  pkg="\${m%@*}"
  caddy list-modules --packages | awk -v p="$pkg" '{ for (i = 1; i <= NF; i++) if ($i == p) found = 1 } END { exit !found }' || missing="$missing $m"
done
if [ -n "$missing" ]; then
  echo "Adding Caddy packages:$missing"
  caddy add-package $missing || { echo "caddy add-package failed - is Caddy's download service reachable?" >&2; exit 1; }
fi
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
`;

function caddyStartCommand(modules) {
  return ["sh", "-c", CADDY_START_SCRIPT, "sh", ...modules];
}
```

In `renderCaddySpec`'s returned object, after `restartPolicy: "unless-stopped",` add:

```js
    ...(challenge ? { command: caddyStartCommand(challenge.modules) } : {}),
```

Update the file header comment's DNS sentence to mention that the Caddy container's start command adds the provider's plugin.

- [ ] **Step 6: Update `catalog.js`**

Replace the `ready` hook on the `caddy` entry (and its comment) with:

```js
    // A custom DNS provider is only usable with a directive to write and a
    // Caddy module to add. Table providers carry their own, and the stock
    // image is fine either way: the module is added when Caddy starts.
    ready: (values) => {
      if (values.tlsMode !== "dns" || values.dnsProvider !== "custom") return null;
      if (!String(values.dnsDirective || "").trim()) return "A custom DNS provider needs a directive.";
      if (!MODULE_PATH.test(String(values.dnsModule || "").trim())) {
        return "A custom DNS provider needs a Caddy module such as github.com/caddy-dns/porkbun.";
      }
      return null;
    },
```

Remove the `CADDY_IMAGE_DEFAULT` constant (no longer used) and add `import { MODULE_PATH } from "../schema/dnsProviders.js";` next to the other schema imports.

- [ ] **Step 7: README**

In `README.md`, replace the paragraph beginning "DNS providers are Caddy plugins, and the stock `caddy:2-alpine` image has none," through the sentence ending "Cloudflare `github.com/caddy-dns/cloudflare`." (the paragraph, the dockerfile code block, and the module-paths sentence) with:

```markdown
DNS providers are Caddy plugins, and the stock `caddy:2-alpine` image has none,
so the Suite adds the plugin for you: in this mode the Caddy container starts
with a small script that runs Caddy's own `caddy add-package` for the
provider's module (Hetzner `github.com/caddy-dns/hetzner/v2`, Cloudflare
`github.com/caddy-dns/cloudflare`, or the **Caddy module** you enter for a
Custom provider, e.g. `github.com/caddy-dns/porkbun`) and then starts Caddy.
Modules the binary already has are skipped, so a restart, or an image that
already includes the plugin, downloads nothing.

Worth knowing:

- Caddy marks `add-package` as experimental.
- A new Caddy container needs internet access and Caddy's download service to
  be reachable the first time it starts. If it isn't, the container exits,
  logs why, and Docker retries; Caddy never runs without the plugin.
- The downloaded build is not version-pinned unless you add `@version` to a
  custom module.
```

Also in the earlier README paragraph of that DNS section, change "**Custom** takes any Caddy DNS module's directive and its environment variables" to "**Custom** takes any Caddy DNS module: its Caddy module path, its directive and its environment variables".

- [ ] **Step 8: Run the tests**

Run: `cd server && node --test test/caddy.test.js test/caddy-start-script.test.js test/spec.test.js`
Expected: PASS, every test in those files.

Then the whole suite: `cd server && npm test`
Expected: all tests pass.

- [ ] **Step 9: Commit**

Message: `Add the DNS provider's Caddy plugin at container start instead of requiring a custom image`

Files: `server/src/schema/dnsProviders.js`, `server/src/schema/caddy.js`, `server/src/reconcile/caddy.js`, `server/src/reconcile/catalog.js`, `README.md`, `server/test/caddy.test.js`, `server/test/caddy-start-script.test.js`
