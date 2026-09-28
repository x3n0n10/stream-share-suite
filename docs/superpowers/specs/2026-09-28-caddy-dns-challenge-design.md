# Caddy DNS-challenge certificates — design

## Goal

Let the Caddy component obtain HTTPS certificates with the ACME **DNS challenge**, so hostnames can be certified without ports 80/443 being reachable from the internet, for a table of known DNS providers (starting with Hetzner and Cloudflare) and for any other provider Caddy can download a plugin for, through a custom entry. The Suite takes care of getting the plugin into Caddy; the operator never builds or pushes an image.

## Decisions

- **The Suite adds the plugin when Caddy starts**, using Caddy's own `caddy add-package` (which replaces the running binary on disk with a build from Caddy's official download service that includes the extra packages). The stock `caddy:2-alpine` image stays the default and works in DNS mode. Publishing or building a plugin image is out of scope. (An earlier revision of this design made the image operator-supplied; that did not fit the Suite's "I'll take care of it" character, and a fixed published image could not cover every provider.)
- Providers come from a **small data table plus a "Custom" entry**. The table is a convenience: a custom entry (module path, directive, environment variables) covers every provider in Caddy's download list.
- The provider token reaches Caddy **only through the container's environment**. The Caddyfile on disk contains the `{env.NAME}` placeholder, never the token.
- Per-site `tls { dns ... }`, not the global `acme_dns` option: the per-site block also carries `propagation_delay`, which Hetzner's own README recommends.
- Verified against the `caddy-dns/hetzner` README: the current module is `github.com/caddy-dns/hetzner/v2`, the directive is `dns hetzner <token>` (a literal token or `{env.NAME}`), and `propagation_delay` sits beside `dns` inside `tls { }`.
- Verified against Caddy's documentation: `caddy add-package <packages...>` replaces the current binary with one that has the same modules plus the listed packages, backs the binary up first and restores it on failure, needs write permission on the binary (the official image runs as root), and is marked **experimental**.

## Design

### Provider table

`server/src/schema/dnsProviders.js`:

```js
export const DNS_PROVIDERS = {
  hetzner:    { label: "Hetzner",    directive: "hetzner {env.HETZNER_API_TOKEN}",       tokenEnv: "HETZNER_API_TOKEN",    module: "github.com/caddy-dns/hetzner/v2" },
  cloudflare: { label: "Cloudflare", directive: "cloudflare {env.CLOUDFLARE_API_TOKEN}", tokenEnv: "CLOUDFLARE_API_TOKEN", module: "github.com/caddy-dns/cloudflare" },
};
```

`module` is now functional, not documentation: it is what gets added to Caddy. The file also exports `MODULE_PATH`, a strict pattern for a Go package path with an optional `@version` suffix (letters, digits, `.`, `_`, `~`, `-`, `/` separators, `@` version). Anything with a space, quote, `;`, `$` or backtick fails it.

### Schema (`schema/caddy.js`)

As already implemented for the DNS mode (`tlsMode` option `dns`, ACME email required for `acme` and `dns`, the provider select, secret token, custom directive, secret env lines, propagation delay), plus:

- New field `dnsModule`, visible and required only when `tlsMode` is `dns` and `dnsProvider` is `custom`: "Caddy module", the Go package of the provider's Caddy plugin, e.g. `github.com/caddy-dns/porkbun` (an `@version` suffix is allowed).
- Help texts no longer say the image must contain the plugin. `tlsMode`'s and `dnsProvider`'s help say Caddy adds the provider's plugin itself when it starts. The `image` help notes that an image that already includes the plugin skips the download.
- The token-switching warning stays on the provider field (a secret field's own help is never rendered by the form).

### Start command

Container specs gain an optional `command` (array of strings), rendered as Docker's `Cmd`. It is part of the spec hash only when set, so no existing spec's hash changes.

In DNS mode the Caddy spec's `command` is `["sh", "-c", CADDY_START_SCRIPT, "sh", ...modules]`. The modules are positional arguments, so validated module text is never interpolated into shell source. The script:

1. Computes a cache key: `cksum` of the image's own `caddy version` output plus the module arguments, before anything is added. The build is cached as `/config/caddy-dns-<key>` (`/config` is the mounted config folder). If that file exists and is executable, the script `exec`s it (`run --config /etc/caddy/Caddyfile --adapter caddyfile`) and nothing is downloaded. This matters because any Caddyfile change recreates the container with a fresh filesystem; a route edit must not depend on the download service being up.
2. Otherwise, for each module argument, checks whether the running binary already has it (`caddy list-modules --packages`, matching the package path without any `@version`).
3. Runs `caddy add-package` once for the modules that are missing.
4. If `add-package` fails, logs that the download service may be unreachable and exits non-zero without caching, so Docker's restart policy retries and the reason is in the container log. It never starts Caddy without the plugin.
5. After a successful `add-package`, copies the new binary to the cache (removing any older `caddy-dns-*` first, so one build is kept; written under a temporary name and moved into place). A failed copy only warns; Caddy still starts. When nothing was missing (the image already has the plugin), nothing is cached.
6. `exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile`, the official image's own command.

An image upgrade or a module change changes the key, so it downloads again and the old build is dropped. `add-package` sends no Caddy version, so it always installs the latest Caddy release regardless of the image tag; `@version` on a module pins only that plugin. The command is passed as Docker `Cmd`, so the image must not set its own ENTRYPOINT in this mode.

Outside DNS mode the spec has no `command`, and the container runs the image's default exactly as before.

### Rendering (`reconcile/caddy.js`)

`dnsChallenge(values)` additionally returns `modules`: the table provider's `module`, or the trimmed `dnsModule` for a custom provider. A custom provider whose `dnsModule` is empty or fails `MODULE_PATH` yields `null`, like a missing directive. `renderCaddyfile` is unchanged from the DNS-mode work. `renderCaddySpec` adds `command` when there is a challenge.

### Guard

The `ready` hook on the Caddy catalog entry no longer checks the image. For a custom provider it reports "A custom DNS provider needs a directive." for a blank directive, and "A custom DNS provider needs a Caddy module such as github.com/caddy-dns/porkbun." for a missing or malformed module. Table providers and other modes are always ready.

### Docs

README, in the Caddy section: the DNS challenge mode and its fields; how Caddy gets the plugin (added with `add-package`, cached in the config folder and reused across recreates and restarts, skipped when the image already has it); and the caveats: Caddy marks the command experimental, the download needs internet access and Caddy's download service (if it fails the container exits, logs why and retries, so check the container log when HTTPS does not come up), the download always installs the latest Caddy release whatever the image tag says and `@version` pins only a custom plugin, the image must not set its own ENTRYPOINT, and the token is stored write-only and never written into the Caddyfile. The xcaddy Dockerfile recipe is removed, replaced by a sentence that a custom image with the plugin baked in also works.

## Testing

- Spec: the hash is unchanged for a spec with no `command` and changes when `command` is set; `toCreatePayload` emits `Cmd` only when `command` is set.
- Provider table: `MODULE_PATH` accepts `github.com/caddy-dns/hetzner/v2`, `github.com/caddy-dns/porkbun`, a path with `@v1.2.3`; rejects spaces, `;`, `$(...)`, backticks, quotes, an empty string and a bare word.
- `dnsChallenge`: `modules` for table providers; a custom provider needs a valid module; existing behaviour (directive, env, delay) unchanged.
- Schema: `dnsModule` required only for the custom provider in DNS mode.
- `renderCaddySpec`: `command` is set in DNS mode with the module as an argument and absent otherwise; the hash changes when the module changes.
- Start script, run for real with `sh` and a stub `caddy` on `PATH`: module already present means no `add-package` and Caddy starts; module missing means `add-package` with exactly that module, then Caddy starts; several modules where one is present adds only the missing one; `@version` is stripped for the presence check but passed to `add-package`; `add-package` failing means a non-zero exit, nothing cached and Caddy not started. Binary cache: the first start caches exactly one `caddy-dns-*` file; a second start with the same modules and version, even with `add-package` failing, does not download and starts Caddy from the cache; a different `caddy version` or different modules miss the cache, download again and leave exactly one (new) cache file; nothing is cached when no module was missing.
- Catalog `ready`: the custom-provider messages, and no image message any more.

## Out of scope

- Publishing, building or defaulting to a Caddy image with plugins.
- Pinning module versions or the Caddy version automatically (`add-package` always fetches the latest Caddy release), mirroring the download service, verifying `add-package`'s output, or keeping more than one cached build.
- Wildcard certificates, other ACME CAs or staging endpoints, and global-level Caddy options.
- Multi-line provider configuration blocks beyond a single directive line, and more than one module per provider.
