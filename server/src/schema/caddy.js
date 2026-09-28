// The Caddy component: an optional reverse proxy that publishes instances
// under a real hostname instead of a raw port, with HTTPS handled for you.
//
// Deliberately no per-instance routing fields here (the one exception is the
// dashboard's own address, below — the Suite has no other place to say where
// it is reached from outside). Each instance already has its own
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
// Optional: most deployments don't publish anything externally, so it stays
// out of the plan entirely until switched on under Stack (see
// CADDY_ENABLED_SETTING in reconcile/catalog.js).

import { DNS_PROVIDERS } from "./dnsProviders.js";

const TABLE_IDS = Object.keys(DNS_PROVIDERS);
const DNS_PROVIDER_OPTIONS = [...TABLE_IDS, "custom"];
const DNS_PROVIDER_LABELS = {
  ...Object.fromEntries(TABLE_IDS.map((id) => [id, DNS_PROVIDERS[id].label])),
  custom: "Custom",
};
const DNS_MODULES = TABLE_IDS.map((id) => `${DNS_PROVIDERS[id].label}: ${DNS_PROVIDERS[id].module}`).join("; ");

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
    {
      key: "acmeEmail",
      envVar: null,
      label: "ACME contact email",
      help: "Sent to your certificate authority for expiry notices only — never published anywhere.",
      group: "HTTPS",
      required: true,
      dependsOn: { key: "tlsMode", oneOf: ["acme", "dns"] },
    },
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
        "Stored write-only and passed to Caddy through its environment; it is never written into the Caddyfile. Switching provider? Enter that provider's token again.",
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
    {
      key: "dashboardUrl",
      envVar: null,
      label: "Dashboard public URL",
      help:
        "Optional. The address this dashboard is reached at from outside, e.g. https://suite.example.com. " +
        "Only the hostname (and port, if any) is used — give it a hostname of its own rather than a path. " +
        "Leave blank to keep the dashboard unpublished. The Suite must be on a Docker network Caddy joins " +
        "(the default streamshare network covers this). Publishing it puts the sign-in page on the internet: " +
        "it has a real login, CSRF protection and a throttled sign-in, but that is now your exposure.",
      group: "Dashboard",
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
        "for you, such as a route to something it doesn't manage. In JSON format.",
      type: "textarea",
      group: "Container",
      advanced: true,
    },
  ],
};
