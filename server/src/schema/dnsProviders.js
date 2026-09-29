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
    // Not /v2, even though that's the module's real go.mod path (and what
    // xcaddy build --with wants): Caddy's add-package download service keys
    // its package registry on the base repo path and resolves the version —
    // including this major bump — through @version instead. Confirmed
    // against the registry (caddyserver.com/api/packages): the hetzner entry
    // is registered at this exact path, and add-package 400s on ".../v2".
    // Pinned to a known-good release rather than left to float to whatever
    // add-package resolves as latest.
    module: "github.com/caddy-dns/hetzner@v2.0.1",
  },
  cloudflare: {
    label: "Cloudflare",
    directive: "cloudflare {env.CLOUDFLARE_API_TOKEN}",
    tokenEnv: "CLOUDFLARE_API_TOKEN",
    // Pinned for the same reason as Hetzner, above.
    module: "github.com/caddy-dns/cloudflare@v0.2.4",
  },
};

// Every module here is pinned to a specific tag rather than left for
// add-package to resolve on its own. Without @version, add-package does not
// necessarily build the latest release — it can build the module's
// unreleased branch HEAD instead, which is exactly what broke Hetzner in a
// real deployment (v2.0.1 was already the newest tag; pinning to it fixed a
// failure that unpinned "latest" did not). Any module a custom provider adds
// should be pinned the same way.

// A Go package path, optionally with an @version suffix, as `caddy
// add-package` takes it. Deliberately strict: it ends up as an argument to a
// shell script, so anything with a space, quote, ;, $ or backtick is refused
// here rather than escaped later.
export const MODULE_PATH = /^[A-Za-z0-9][A-Za-z0-9._~-]*(\/[A-Za-z0-9._~-]+)+(@[A-Za-z0-9._+-]+)?$/;
