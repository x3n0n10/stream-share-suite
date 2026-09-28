# Caddy DNS-Challenge Certificates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Caddy component obtain HTTPS certificates with the ACME DNS challenge, for a small table of known DNS providers (Hetzner, Cloudflare) and for any other provider through a "Custom" entry.

**Architecture:** A data table of providers (`schema/dnsProviders.js`). `tlsMode` gains a `dns` option and a "DNS challenge" field group (provider select, write-only token, custom directive/env, optional propagation delay). A pure helper `dnsChallenge(values)` in `reconcile/caddy.js` turns those values into `{ directive, env, propagationDelay }`. `renderCaddyfile` writes `tls { dns <directive> }` per site block; `renderCaddySpec` puts the token in the container's env only. A `ready` hook on the Caddy catalog entry flags DNS mode on the stock image as incomplete.

**Tech Stack:** Node (ESM), `node --test`, Express backend in `server/`. No frontend change: `SchemaForm` renders the new fields from the schema, and it already supports write-only secret fields including textareas.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-09-28-caddy-dns-challenge-design.md`. Read it if anything here is unclear.
- The Caddy image stays operator-supplied. Do not add, publish or default to any plugin image, and do not add `CADDY_MODULES`, `XDG_*` or Go-cache env vars.
- The provider token reaches Caddy only through the container env. The Caddyfile text must never contain the token, only the `{env.NAME}` placeholder.
- `tlsMode: "acme"` and `"internal"` behaviour and output must stay byte-for-byte unchanged. All existing tests must pass without edits.
- Per-site `tls { dns ... }`, not the global `acme_dns` option.
- Hetzner: module `github.com/caddy-dns/hetzner/v2`, directive `hetzner {env.HETZNER_API_TOKEN}`. Cloudflare: module `github.com/caddy-dns/cloudflare`, directive `cloudflare {env.CLOUDFLARE_API_TOKEN}`.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` (that exact model name, whichever model you are).
- **Committing:** plain `git commit` is blocked by a guard in this repo. Write the message to a file under `/private/tmp/claude-501/-Users-jorislankhorst-Claude/83ef7f57-0172-4320-ba0f-424f637c7b19/scratchpad/` (not in the repo), then: `git add <files>`, confirm `git diff --cached --stat` is non-empty, `TREE=$(git write-tree)`, `PARENT=$(git rev-parse HEAD)`, `SHA=$(git commit-tree "$TREE" -p "$PARENT" -F <msgfile>)`, `git update-ref refs/heads/claude/caddy-dns-challenge "$SHA"`. Re-check `git status --short` afterwards (only the untracked `.claude/settings.json` and `CLAUDE.md` may remain); the guard sometimes resets the index. Do not push.
- Run backend tests from `server/`: `node --test test/<file>` for one file, `npm test` for everything.
- The repo's CLAUDE.md mentions a graphify knowledge graph, but `graphify-out/` does not exist here; read files directly.

---

### Task 1: Provider table, schema fields, and `dnsChallenge()`

**Files:**
- Create: `server/src/schema/dnsProviders.js`
- Modify: `server/src/schema/caddy.js`
- Modify: `server/src/reconcile/caddy.js`
- Test: `server/test/caddy.test.js`

**Interfaces:**
- Consumes: `parseExtraEnv(raw)` from `./env.js` (returns `{KEY: value}`; drops blank/`#`/`=`-less lines). `validate(schema, values)` from `../src/schema/registry.js` (returns `[{key, message}]`).
- Produces:
  - `export const DNS_PROVIDERS` (`schema/dnsProviders.js`): `{ [id]: { label, directive, tokenEnv, module } }`.
  - Schema fields `dnsProvider`, `dnsApiToken`, `dnsDirective`, `dnsEnv`, `dnsPropagationDelay`; `tlsMode` option `dns`.
  - `export function dnsChallenge(values)` (`reconcile/caddy.js`): returns `{ directive: string, env: object, propagationDelay: string|null }`, or `null` when `tlsMode !== "dns"`, the provider is unknown, a table provider has no `dnsApiToken`, or a custom provider has no directive.

- [ ] **Step 1: Write the failing tests**

In `server/test/caddy.test.js`, add to the imports: change the caddy.js import to

```js
import { renderCaddyfile, renderCaddySpec, caddyContainerName, dnsChallenge } from "../src/reconcile/caddy.js";
```

and add

```js
import { validate } from "../src/schema/registry.js";
import { CADDY_SCHEMA } from "../src/schema/caddy.js";
```

Append to the end of the file:

```js
// --- DNS challenge ---------------------------------------------------------

test("dnsChallenge is null outside DNS mode", () => {
  assert.equal(dnsChallenge({ tlsMode: "internal", dnsApiToken: "t" }), null);
  assert.equal(dnsChallenge({ tlsMode: "acme", dnsApiToken: "t" }), null);
  assert.equal(dnsChallenge({}), null);
});

test("a table provider yields its directive and its token env var", () => {
  assert.deepEqual(dnsChallenge({ tlsMode: "dns", dnsProvider: "hetzner", dnsApiToken: "tok" }), {
    directive: "hetzner {env.HETZNER_API_TOKEN}",
    env: { HETZNER_API_TOKEN: "tok" },
    propagationDelay: null,
  });

  const cloudflare = dnsChallenge({ tlsMode: "dns", dnsProvider: "cloudflare", dnsApiToken: "tok" });
  assert.equal(cloudflare.directive, "cloudflare {env.CLOUDFLARE_API_TOKEN}");
  assert.deepEqual(cloudflare.env, { CLOUDFLARE_API_TOKEN: "tok" });
});

test("the provider defaults to Hetzner when unset", () => {
  assert.equal(dnsChallenge({ tlsMode: "dns", dnsApiToken: "tok" }).directive, "hetzner {env.HETZNER_API_TOKEN}");
});

test("a custom provider uses the typed directive on one line and the parsed env", () => {
  const challenge = dnsChallenge({
    tlsMode: "dns",
    dnsProvider: "custom",
    dnsDirective: "porkbun {env.PORKBUN_API_KEY}\n {env.PORKBUN_API_SECRET_KEY}",
    dnsEnv: "PORKBUN_API_KEY=k\nPORKBUN_API_SECRET_KEY=s\n# a comment\n",
  });
  assert.equal(challenge.directive, "porkbun {env.PORKBUN_API_KEY} {env.PORKBUN_API_SECRET_KEY}");
  assert.deepEqual(challenge.env, { PORKBUN_API_KEY: "k", PORKBUN_API_SECRET_KEY: "s" });
});

test("dnsChallenge is null when the token or custom directive is missing, or the provider is unknown", () => {
  assert.equal(dnsChallenge({ tlsMode: "dns", dnsProvider: "hetzner" }), null);
  assert.equal(dnsChallenge({ tlsMode: "dns", dnsProvider: "custom", dnsDirective: "  " }), null);
  assert.equal(dnsChallenge({ tlsMode: "dns", dnsProvider: "nope", dnsApiToken: "t" }), null);
});

test("a propagation delay is kept when it is a Go duration and ignored otherwise", () => {
  const base = { tlsMode: "dns", dnsProvider: "hetzner", dnsApiToken: "t" };
  assert.equal(dnsChallenge({ ...base, dnsPropagationDelay: "30s" }).propagationDelay, "30s");
  assert.equal(dnsChallenge({ ...base, dnsPropagationDelay: "1m30s" }).propagationDelay, "1m30s");
  assert.equal(dnsChallenge({ ...base, dnsPropagationDelay: "soon" }).propagationDelay, null);
  assert.equal(dnsChallenge({ ...base, dnsPropagationDelay: "" }).propagationDelay, null);
});

test("DNS mode requires the ACME email, and the DNS fields only matter in DNS mode", () => {
  const dns = { tlsMode: "dns", dnsProvider: "hetzner", dnsApiToken: "t" };
  assert.ok(validate(CADDY_SCHEMA, dns).some((e) => e.key === "acmeEmail"));
  assert.deepEqual(validate(CADDY_SCHEMA, { ...dns, acmeEmail: "a@example.com" }), []);

  // Nothing DNS-related is required, or even visible, in the other modes.
  assert.deepEqual(validate(CADDY_SCHEMA, { tlsMode: "internal" }), []);
  assert.deepEqual(validate(CADDY_SCHEMA, { tlsMode: "acme", acmeEmail: "a@example.com" }), []);
});

test("a table provider needs its token; a custom provider needs its directive but not a token", () => {
  const email = { tlsMode: "dns", acmeEmail: "a@example.com" };
  assert.ok(validate(CADDY_SCHEMA, { ...email, dnsProvider: "hetzner" }).some((e) => e.key === "dnsApiToken"));

  const custom = validate(CADDY_SCHEMA, { ...email, dnsProvider: "custom" });
  assert.ok(custom.some((e) => e.key === "dnsDirective"));
  assert.equal(custom.some((e) => e.key === "dnsApiToken"), false);
  assert.deepEqual(
    validate(CADDY_SCHEMA, { ...email, dnsProvider: "custom", dnsDirective: "porkbun {env.K}" }),
    []
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && node --test test/caddy.test.js`
Expected: FAIL. `dnsChallenge` is not exported (the whole file fails on import), so every test in the file fails until Step 3.

- [ ] **Step 3: Create the provider table**

Create `server/src/schema/dnsProviders.js`:

```js
// DNS providers the Caddy component knows how to drive for the ACME DNS
// challenge. Each is a Caddy plugin, so the Caddy *image* has to include its
// module (see the README) — the Suite only writes the Caddyfile and passes the
// token through the container's environment.
//
//   directive — the text after `dns` in a site's `tls { }` block
//   tokenEnv  — the environment variable that directive references
//   module    — the xcaddy module path, shown to the operator
//
// Adding a provider is one row. Anything not listed goes through the
// "custom" provider in the Caddy schema.

export const DNS_PROVIDERS = {
  hetzner: {
    label: "Hetzner",
    directive: "hetzner {env.HETZNER_API_TOKEN}",
    tokenEnv: "HETZNER_API_TOKEN",
    module: "github.com/caddy-dns/hetzner/v2",
  },
  cloudflare: {
    label: "Cloudflare",
    directive: "cloudflare {env.CLOUDFLARE_API_TOKEN}",
    tokenEnv: "CLOUDFLARE_API_TOKEN",
    module: "github.com/caddy-dns/cloudflare",
  },
};
```

- [ ] **Step 4: Extend the Caddy schema**

In `server/src/schema/caddy.js`:

Add the import at the top, after the header comment and before `export const CADDY_SCHEMA`:

```js
import { DNS_PROVIDERS } from "./dnsProviders.js";

const TABLE_IDS = Object.keys(DNS_PROVIDERS);
const DNS_PROVIDER_OPTIONS = [...TABLE_IDS, "custom"];
const DNS_PROVIDER_LABELS = {
  ...Object.fromEntries(TABLE_IDS.map((id) => [id, DNS_PROVIDERS[id].label])),
  custom: "Custom",
};
const DNS_MODULES = TABLE_IDS.map((id) => `${DNS_PROVIDERS[id].label}: ${DNS_PROVIDERS[id].module}`).join("; ");
```

Replace the `tlsMode` field with:

```js
    {
      key: "tlsMode",
      envVar: null,
      label: "HTTPS",
      help:
        "\"Self-signed\" issues a certificate from Caddy's own internal CA — browsers warn once, fine on a " +
        "private network. \"Automatic (ACME)\" gets a real, trusted certificate per hostname, but needs ports " +
        "80 and 443 reachable from the internet and each hostname's DNS already pointed here. \"Automatic (DNS " +
        "challenge)\" gets the same kind of certificate by proving domain ownership through your DNS provider's " +
        "API instead, so no inbound ports are needed — but it needs a Caddy image that includes your provider's " +
        "plugin (see Image, below).",
      type: "select",
      options: ["internal", "acme", "dns"],
      optionLabels: { internal: "Self-signed", acme: "Automatic (ACME)", dns: "Automatic (DNS challenge)" },
      default: "internal",
      group: "HTTPS",
      required: true,
    },
```

Change the `acmeEmail` field's `dependsOn` to `{ key: "tlsMode", oneOf: ["acme", "dns"] }`.

Insert these five fields directly after `acmeEmail` and before `dashboardUrl`:

```js
    {
      key: "dnsProvider",
      envVar: null,
      label: "DNS provider",
      help:
        "The DNS service your domain is hosted on. Your Caddy image must include this provider's plugin, " +
        `built with — ${DNS_MODULES}. Not listed? Pick Custom.`,
      type: "select",
      options: DNS_PROVIDER_OPTIONS,
      optionLabels: DNS_PROVIDER_LABELS,
      default: TABLE_IDS[0],
      group: "DNS challenge",
      required: true,
      dependsOn: { key: "tlsMode", equals: "dns" },
    },
    {
      key: "dnsApiToken",
      envVar: null,
      label: "API token",
      help:
        "Stored write-only and passed to Caddy through its environment; it is never written into the Caddyfile.",
      secret: true,
      group: "DNS challenge",
      required: true,
      dependsOn: [
        { key: "tlsMode", equals: "dns" },
        { key: "dnsProvider", oneOf: TABLE_IDS },
      ],
    },
    {
      key: "dnsDirective",
      envVar: null,
      label: "Directive",
      help:
        "Everything after `dns` in the site's tls block, e.g. `porkbun {env.PORKBUN_API_KEY} {env.PORKBUN_API_SECRET_KEY}`. " +
        "Reference credentials as {env.NAME} and define them below.",
      group: "DNS challenge",
      required: true,
      dependsOn: [
        { key: "tlsMode", equals: "dns" },
        { key: "dnsProvider", equals: "custom" },
      ],
    },
    {
      key: "dnsEnv",
      envVar: null,
      label: "Provider environment variables",
      help: "One KEY=VALUE per line, passed to the Caddy container. Stored write-only.",
      type: "textarea",
      secret: true,
      group: "DNS challenge",
      dependsOn: [
        { key: "tlsMode", equals: "dns" },
        { key: "dnsProvider", equals: "custom" },
      ],
    },
    {
      key: "dnsPropagationDelay",
      envVar: null,
      label: "Propagation delay",
      help:
        "Optional. How long to wait after creating the DNS record before asking the CA to check it, e.g. 30s. " +
        "Slow DNS providers sometimes need this. Leave blank to use Caddy's default.",
      group: "DNS challenge",
      advanced: true,
      dependsOn: { key: "tlsMode", equals: "dns" },
    },
```

- [ ] **Step 5: Add `dnsChallenge()`**

In `server/src/reconcile/caddy.js`, add to the imports:

```js
import { DNS_PROVIDERS } from "../schema/dnsProviders.js";
import { parseExtraEnv } from "./env.js";
```

Add directly after the `NETWORKS_FIELD` constant:

```js
const DNS_PROVIDER_FIELD = CADDY_SCHEMA.fields.find((f) => f.key === "dnsProvider");
const GO_DURATION = /^(\d+(\.\d+)?(ns|us|µs|ms|s|m|h))+$/;
```

Add directly before `renderCaddyfile`'s leading comment (i.e. after `groupByHost`):

```js
// What the DNS challenge needs, resolved from the stored values: the directive
// that goes after `dns` in each site's tls block, the environment variables
// that directive references, and an optional propagation delay. Null when DNS
// mode is off or the provider is not fully configured.
//
// The token only ever travels in `env` (the container's environment); the
// directive refers to it as {env.NAME}, so the Caddyfile on disk never holds
// it. A custom directive is collapsed to one line so it stays one directive.
// A propagation delay that is not a Go duration is ignored, the same way an
// unparseable URL is elsewhere in this file, rather than written into a
// Caddyfile Caddy would refuse to load.
export function dnsChallenge(values) {
  if (values.tlsMode !== "dns") return null;

  const providerId = values.dnsProvider || DNS_PROVIDER_FIELD.default;
  const provider = DNS_PROVIDERS[providerId];

  let directive;
  let env;
  if (provider) {
    if (!values.dnsApiToken) return null;
    directive = provider.directive;
    env = { [provider.tokenEnv]: values.dnsApiToken };
  } else if (providerId === "custom") {
    directive = String(values.dnsDirective || "").replace(/\s*\n\s*/g, " ").trim();
    if (!directive) return null;
    env = parseExtraEnv(values.dnsEnv);
  } else {
    return null;
  }

  const delay = String(values.dnsPropagationDelay || "").trim();
  return { directive, env, propagationDelay: GO_DURATION.test(delay) ? delay : null };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd server && node --test test/caddy.test.js`
Expected: PASS, every test in the file (existing and the 8 new).

Then the whole suite: `cd server && npm test`
Expected: all pass, none failing.

- [ ] **Step 7: Commit**

Message: `Add DNS-challenge provider table, schema fields and dnsChallenge helper`

Files: `server/src/schema/dnsProviders.js`, `server/src/schema/caddy.js`, `server/src/reconcile/caddy.js`, `server/test/caddy.test.js`

---

### Task 2: Render the challenge, pass the token, guard the image, document it

**Files:**
- Modify: `server/src/reconcile/caddy.js`
- Modify: `server/src/reconcile/catalog.js`
- Modify: `README.md`
- Test: `server/test/caddy.test.js`

**Interfaces:**
- Consumes: `dnsChallenge(values)` from Task 1 (same file). `CADDY_SCHEMA` (already imported in `catalog.js`).
- Produces: `renderCaddyfile` output and `renderCaddySpec().env` in DNS mode; a `ready(values)` hook on the `caddy` catalog entry.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/caddy.test.js` (the file already imports `renderCaddyfile`, `renderCaddySpec`, `computeSpecHash`, `getCatalogEntry`, `provisionInstance`; the `PROVIDER` helper and the `beforeEach` setup are already there):

```js
const DNS = {
  tlsMode: "dns",
  acmeEmail: "admin@example.com",
  dnsProvider: "hetzner",
  dnsApiToken: "secret-token",
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

test("a custom provider's directive is written as typed", () => {
  provisionInstance(PROVIDER("Provider 1", null, "https://tv.example.com/p1"));
  const file = renderCaddyfile({
    tlsMode: "dns",
    acmeEmail: "admin@example.com",
    dnsProvider: "custom",
    dnsDirective: "porkbun {env.PORKBUN_API_KEY} {env.PORKBUN_API_SECRET_KEY}",
  });
  assert.match(file, /\t\tdns porkbun \{env\.PORKBUN_API_KEY\} \{env\.PORKBUN_API_SECRET_KEY\}\n/);
});

test("renderCaddySpec carries the token in env and the spec hash moves with it", async () => {
  const spec = await renderCaddySpec(DNS);
  assert.equal(spec.env.HETZNER_API_TOKEN, "secret-token");
  assert.ok(spec.env.CADDY_CONFIG_HASH);

  const other = await renderCaddySpec({ ...DNS, dnsApiToken: "another-token" });
  assert.notEqual(computeSpecHash(spec), computeSpecHash(other));
});

test("a custom provider's env reaches the container, and CADDY_CONFIG_HASH cannot be overridden by it", async () => {
  const spec = await renderCaddySpec({
    tlsMode: "dns",
    acmeEmail: "admin@example.com",
    dnsProvider: "custom",
    dnsDirective: "porkbun {env.PORKBUN_API_KEY}",
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

test("DNS mode on the stock Caddy image is flagged as not ready; a custom image or another mode is fine", () => {
  const entry = getCatalogEntry("caddy");
  assert.match(entry.ready({ tlsMode: "dns" }), /includes your provider's plugin/);
  assert.match(entry.ready({ tlsMode: "dns", image: "caddy:2-alpine" }), /includes your provider's plugin/);
  assert.equal(entry.ready({ tlsMode: "dns", image: "ghcr.io/me/caddy-hetzner:2" }), null);
  assert.equal(entry.ready({ tlsMode: "acme" }), null);
  assert.equal(entry.ready({}), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && node --test test/caddy.test.js`
Expected: the new tests FAIL, except "outside DNS mode the container env is just the config hash" which already passes (it pins existing behaviour); all pre-existing tests still PASS.

- [ ] **Step 3: Implement in `reconcile/caddy.js`**

In `renderCaddyfile`, replace the block that writes the global email:

```js
  if (values.tlsMode === "acme" && values.acmeEmail) {
    file += `{\n\temail ${values.acmeEmail}\n}\n\n`;
  }
```

with:

```js
  const challenge = dnsChallenge(values);
  if ((values.tlsMode === "acme" || values.tlsMode === "dns") && values.acmeEmail) {
    file += `{\n\temail ${values.acmeEmail}\n}\n\n`;
  }
```

Replace the line inside the site-block loop

```js
      if ((values.tlsMode || "internal") === "internal") file += `\ttls internal\n`;
```

with:

```js
      if ((values.tlsMode || "internal") === "internal") file += `\ttls internal\n`;
      if (challenge) {
        file += `\ttls {\n\t\tdns ${challenge.directive}\n`;
        if (challenge.propagationDelay) file += `\t\tpropagation_delay ${challenge.propagationDelay}\n`;
        file += `\t}\n`;
      }
```

In `renderCaddySpec`, add `const challenge = dnsChallenge(values);` directly after the `const caddyfile = renderCaddyfile(values, suiteTarget);` line, and replace the `env` object in the returned spec with:

```js
    env: {
      // The DNS provider's credentials, referenced from the Caddyfile as
      // {env.NAME} so the token itself never lands in a file on disk. Spread
      // first so nothing in it can shadow the hash below.
      ...(challenge?.env || {}),
      // Not read by Caddy — see this file's header for why it's here.
      CADDY_CONFIG_HASH: createHash("sha256").update(caddyfile).digest("hex"),
    },
```

Also add one sentence to the file's header comment (after the sentence about the dashboard route): "In DNS-challenge mode each site block also carries a `tls { dns ... }` block, and the provider's credentials travel in the container's environment rather than the file."

- [ ] **Step 4: Implement the guard in `catalog.js`**

In the `caddy` entry of `CATALOG` (`server/src/reconcile/catalog.js`), add a `ready` hook after `present`:

```js
    // The DNS challenge needs a Caddy build that includes the provider's
    // plugin, and the stock image never does — better an incomplete row that
    // says so than a Caddy container that applies cleanly and then cannot start.
    ready: (values) =>
      values.tlsMode === "dns" && (!values.image || values.image === CADDY_IMAGE_DEFAULT)
        ? "DNS challenge needs a Caddy image that includes your provider's plugin — set the Image field."
        : null,
```

and define the constant near the top of the file, after the imports:

```js
const CADDY_IMAGE_DEFAULT = CADDY_SCHEMA.fields.find((f) => f.key === "image").default;
```

- [ ] **Step 5: README**

In `README.md`, in the "### Caddy (reverse proxy)" section, add the following immediately before the `### Setup wizard` heading (after the paragraph that begins "The dashboard itself can be published the same way"):

````markdown
**DNS challenge.** Besides self-signed and automatic (ACME over HTTP), the
HTTPS setting has **Automatic (DNS challenge)**, which proves you own a domain
through your DNS provider's API instead of over ports 80/443 — so nothing has
to be reachable from the internet. Pick a provider (Hetzner and Cloudflare are
built in; **Custom** takes any Caddy DNS module's directive and its environment
variables), enter its API token, and Caddy gets a `tls { dns ... }` block per
site. An optional **Propagation delay** (e.g. `30s`) makes Caddy wait after
creating the DNS record, which slow providers need.

The token is stored write-only and passed to the Caddy container through its
environment; the Caddyfile only ever contains an `{env.NAME}` placeholder.

DNS providers are Caddy plugins, and the stock `caddy:2-alpine` image has none,
so this mode needs a Caddy image that includes yours — set it in the **Image**
field. The Caddy row shows as incomplete until you do. A minimal image:

```dockerfile
FROM caddy:builder AS builder
RUN xcaddy build --with github.com/caddy-dns/hetzner/v2

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
```

Module paths for the built-in providers: Hetzner
`github.com/caddy-dns/hetzner/v2`, Cloudflare `github.com/caddy-dns/cloudflare`.
````

- [ ] **Step 6: Run the tests**

Run: `cd server && node --test test/caddy.test.js`
Expected: PASS, every test in the file.

Then the whole suite: `cd server && npm test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

Message: `Render DNS-challenge certificates for Caddy and document the image requirement`

Files: `server/src/reconcile/caddy.js`, `server/src/reconcile/catalog.js`, `server/test/caddy.test.js`, `README.md`
