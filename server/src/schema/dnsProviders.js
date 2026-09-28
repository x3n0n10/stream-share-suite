// DNS providers the Caddy component knows how to drive for the ACME DNS
// challenge. Each is a Caddy plugin; the Suite adds it to Caddy when the
// container starts (see CADDY_START_SCRIPT in reconcile/caddy.js), writes the
// Caddyfile, and passes the token through the container's environment.
//
//   directive — the text after `dns` in a site's `tls { }` block
//   tokenEnv  — the environment variable that directive references
//   module    — the Go package the Suite adds to Caddy at start
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

// A Go package path, optionally with an @version suffix, as `caddy
// add-package` takes it. Deliberately strict: it ends up as an argument to a
// shell script, so anything with a space, quote, ;, $ or backtick is refused
// here rather than escaped later.
export const MODULE_PATH = /^[A-Za-z0-9][A-Za-z0-9._~-]*(\/[A-Za-z0-9._~-]+)+(@[A-Za-z0-9._+-]+)?$/;
