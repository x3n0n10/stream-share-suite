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
