// The Caddy component: an optional reverse proxy that publishes instances
// under a real hostname instead of a raw port, with HTTPS handled for you.
//
// Deliberately no routing fields here. Each instance already has its own
// "Public base URL" (see schema/instance.js) — the address stream-share tells
// its own players to use — and that is the one place an operator should have
// to say "this is how the outside world reaches this instance." Rather than
// asking the same thing twice, Caddy's Caddyfile is generated straight from
// whichever instances have that field set: its hostname becomes a site
// block, its path (if any) becomes a handle_path, and the target is the same
// address the dashboard itself already computes for that instance. An
// instance with no public base URL simply isn't routed — see reconcile/caddy.js.
//
// Caddy joins the shared network rather than gluetun's namespace: it has to
// reach gluetun (VPN on) or each instance's own container (VPN off) by name
// over Docker's own DNS, which only works between containers on the same
// network — sharing a namespace is a different, stronger relationship this
// doesn't need.
//
// Optional, like UHF: most deployments don't publish anything externally, so
// it stays out of the plan entirely until switched on under Stack (see
// CADDY_ENABLED_SETTING in reconcile/catalog.js).

export const CADDY_SCHEMA = {
  kind: "caddy",
  label: "Caddy (reverse proxy)",
  fields: [
    {
      key: "tlsMode",
      envVar: null,
      label: "HTTPS",
      help:
        "\"Self-signed\" issues a certificate from Caddy's own internal CA — browsers warn once, fine on a " +
        "private network. \"Automatic (ACME)\" gets a real, trusted certificate per hostname, but needs ports " +
        "80 and 443 reachable from the internet and each hostname's DNS already pointed here.",
      type: "select",
      options: ["internal", "acme"],
      default: "internal",
      group: "HTTPS",
      required: true,
    },
    {
      key: "acmeEmail",
      envVar: null,
      label: "ACME contact email",
      help: "Sent to your certificate authority for expiry notices only — never published anywhere.",
      group: "HTTPS",
      required: true,
      dependsOn: { key: "tlsMode", equals: "acme" },
    },
    {
      key: "networks",
      envVar: null,
      label: "Docker networks to join",
      help:
        "Comma-separated. Must include whatever network gluetun and your instances are reachable on. Defaults " +
        "to the streamshare network the Suite's own compose file already declares.",
      group: "Container",
      required: true,
      advanced: true,
      default: "streamshare",
    },
    {
      key: "httpPort",
      envVar: null,
      label: "HTTP port",
      help: "The host port Caddy answers plain HTTP on (and redirects to HTTPS from, in ACME mode).",
      group: "Container",
      default: "80",
      advanced: true,
    },
    {
      key: "httpsPort",
      envVar: null,
      label: "HTTPS port",
      group: "Container",
      default: "443",
      advanced: true,
    },
    {
      key: "image",
      envVar: null,
      label: "Image",
      help: "Any Caddy 2 tag.",
      group: "Container",
      default: "caddy:2-alpine",
      advanced: true,
    },
    {
      key: "containerName",
      envVar: null,
      label: "Container name",
      help:
        "Defaults to the Suite's container prefix followed by caddy (streamshare-suite-caddy unless " +
        "overridden). Point it at a container you already run and the Suite will adopt that one instead of " +
        "creating a second.",
      group: "Container",
      advanced: true,
    },
    {
      key: "extraCaddyfile",
      envVar: null,
      label: "Extra Caddyfile",
      help:
        "Raw Caddyfile text appended after every generated site block — for anything the Suite doesn't render " +
        "for you, such as a route to something it doesn't manage.",
      type: "textarea",
      group: "Container",
      advanced: true,
    },
  ],
};
