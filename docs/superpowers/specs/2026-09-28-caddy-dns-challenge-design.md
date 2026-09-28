# Caddy DNS-challenge certificates — design

## Goal

Let the Caddy component obtain HTTPS certificates with the ACME **DNS challenge**, so hostnames can be certified without ports 80/443 being reachable from the internet, for a table of known DNS providers (starting with Hetzner and Cloudflare) and for any other provider through a custom entry.

## Decisions

- The Caddy image stays **operator-supplied**. DNS providers are Caddy plugins that the stock `caddy:2-alpine` image (the default) does not contain, and the Suite can pull images but not build them (the socket proxy has no build permission). The existing `Image` field remains the one place to say which Caddy build to run. The Suite does not publish or default to any plugin image.
- Providers come from a **small data table plus a "Custom" entry**. Adding a provider later is one table row.
- The provider token reaches Caddy **only through the container's environment**. The Caddyfile on disk contains the `{env.NAME}` placeholder, never the token.
- Per-site `tls { dns ... }`, not the global `acme_dns` option: the per-site block also carries `propagation_delay`, which Hetzner's own README recommends.
- Verified against the `caddy-dns/hetzner` README: the current module is `github.com/caddy-dns/hetzner/v2`, the directive is `dns hetzner <token>` (a literal token or `{env.NAME}`), and `propagation_delay` sits beside `dns` inside `tls { }`.

## Design

### Provider table

New data file `server/src/schema/dnsProviders.js`:

```js
export const DNS_PROVIDERS = {
  hetzner:    { label: "Hetzner",    directive: "hetzner {env.HETZNER_API_TOKEN}",       tokenEnv: "HETZNER_API_TOKEN",    module: "github.com/caddy-dns/hetzner/v2" },
  cloudflare: { label: "Cloudflare", directive: "cloudflare {env.CLOUDFLARE_API_TOKEN}", tokenEnv: "CLOUDFLARE_API_TOKEN", module: "github.com/caddy-dns/cloudflare" },
};
```

`directive` is the text after `dns`; `tokenEnv` is the environment variable the directive references; `module` is the xcaddy module path (documentation only).

### Schema (`schema/caddy.js`)

- `tlsMode` gains a third option, `dns`, labelled "Automatic (DNS challenge)". Its help text gains one sentence saying the DNS challenge needs no inbound ports and needs a Caddy image with the provider's plugin.
- `acmeEmail` is required for both `acme` and `dns` (`dependsOn: { key: "tlsMode", oneOf: ["acme", "dns"] }`).
- New group "DNS challenge", every field visible only when `tlsMode` is `dns`:
  - `dnsProvider`: `select` over the table's ids plus `custom`, required, default `hetzner`. Help text lists each table provider's module path.
  - `dnsApiToken`: secret, required, only when `dnsProvider` is a table id.
  - `dnsDirective`: required, only when `dnsProvider` is `custom`. The text after `dns`, for example `porkbun {env.PORKBUN_API_KEY} {env.PORKBUN_API_SECRET_KEY}`.
  - `dnsEnv`: secret textarea, optional, only when `dnsProvider` is `custom`. `KEY=VALUE` per line, parsed with the existing `parseExtraEnv`.
  - `dnsPropagationDelay`: advanced, optional. A Go duration such as `30s`. Blank means omitted.

### Rendering (`reconcile/caddy.js`)

A helper `dnsChallenge(values)` returns `{ directive, env, propagationDelay }` or `null` when `tlsMode` is not `dns` or the provider is incomplete:

- Table provider: `directive` from the table, `env` is `{ [tokenEnv]: values.dnsApiToken }`.
- Custom: `directive` is `values.dnsDirective` with any newline replaced by a space so it stays one directive line; `env` is `parseExtraEnv(values.dnsEnv)`.
- `propagationDelay` is used only when it matches a simple Go-duration pattern; anything else is ignored, like an unparseable URL elsewhere in this file.

`renderCaddyfile`: in `dns` mode the global block gets the `email` line (as in `acme` mode) and every site block gets

```
	tls {
		dns <directive>
		propagation_delay <delay>   # only when set
	}
```

in place of `tls internal`. `acme` mode is unchanged.

`renderCaddySpec`: `spec.env` gains the challenge's `env`, after `CADDY_CONFIG_HASH` (which already covers the Caddyfile text). Env values are part of the spec hash, so changing the token recreates Caddy.

### Guard

The Caddy catalog entry gets a `ready(values)` hook. When `tlsMode` is `dns` and the image is blank or still the stock default `caddy:2-alpine`, it returns "DNS challenge needs a Caddy image that includes your provider's plugin — set the Image field." The plan then shows the Caddy row as incomplete instead of applying a Caddy that cannot start.

### Docs

README, in the Caddy section: the new HTTPS mode, the fields, and the standard xcaddy recipe for an image with a plugin:

```dockerfile
FROM caddy:builder AS builder
RUN xcaddy build --with github.com/caddy-dns/hetzner/v2
FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
```

with the module path per table provider, and a note that the token is stored write-only and is never written into the Caddyfile.

## Testing

- `dnsChallenge`: Hetzner and Cloudflare directives and env; custom directive with a newline collapsed; custom env parsed; `null` when not in `dns` mode; `null` when the token or custom directive is missing; a bad propagation delay ignored, a good one kept.
- `renderCaddyfile`: `dns` mode has the global `email`, `tls { dns ... }` in every site block and no `tls internal`; `propagation_delay` appears only when set; `acme` and `internal` output unchanged; the Caddyfile text never contains the token.
- `renderCaddySpec`: `env` carries the token variable; the spec hash changes when the token changes.
- Schema: `acmeEmail` required in `dns` mode; the DNS fields are hidden outside `dns` mode; `dnsApiToken` required only for table providers, `dnsDirective` only for custom.
- Catalog `ready`: incomplete for `dns` mode on the default or blank image; ready with a custom image; unaffected in other modes.

## Out of scope

- Publishing, building or defaulting to a Caddy image with plugins (including third-party "modular" images).
- Wildcard certificates, other ACME CAs or staging endpoints, and global-level Caddy options.
- Multi-line provider configuration blocks beyond a single directive line.
