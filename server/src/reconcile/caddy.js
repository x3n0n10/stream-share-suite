// Renders the Caddy component to a container spec, including the Caddyfile
// itself — Caddy has no environment-variable configuration surface, so
// unlike every other component here the render step also writes a real file
// to the bind-mounted config directory rather than only building an env map.
//
// That file's content is derived data (which instances have a public base
// URL right now), the same way gluetun's FIREWALL_OUTBOUND_SUBNETS or its
// published ports are — see catalog.js and gluetun.js. Writing it during
// render is exactly as safe as those: idempotent, and re-run on every plan.
// The dashboard itself is one more route of the same kind, from the Caddy
// component's own `dashboardUrl` field. In DNS-challenge mode each site block
// also carries a `tls { dns ... }` block, the provider's credentials travel in
// the container's environment rather than the file, and the container's start
// command adds the provider's plugin to Caddy.
//
// The one thing that needs extra care is the spec hash (see docker/spec.js):
// it's computed over the spec object, never over what ends up on disk, so a
// route added to an instance would otherwise leave Caddy reading as "no
// change" and serving stale routes indefinitely. CADDY_CONFIG_HASH exists
// solely to put the file's content into that hash.

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { CADDY_SCHEMA } from "../schema/caddy.js";
import { DNS_PROVIDERS, MODULE_PATH } from "../schema/dnsProviders.js";
import { listComponents, getComponentValues } from "../store/components.js";
import { componentDataDir, ensureDirectory } from "../store/paths.js";
import { instanceUrl } from "./instance.js";
import { parseExtraEnv } from "./env.js";
import { containerPrefix } from "./prefix.js";
import { getSelfContainerName } from "../docker/self.js";

const NETWORKS_FIELD = CADDY_SCHEMA.fields.find((f) => f.key === "networks");
const IMAGE_FIELD = CADDY_SCHEMA.fields.find((f) => f.key === "image");
const DNS_PROVIDER_FIELD = CADDY_SCHEMA.fields.find((f) => f.key === "dnsProvider");
const GO_DURATION = /^(\d+(\.\d+)?(ns|us|µs|ms|s|m|h))+$/;

export function caddyContainerName(values = {}) {
  return String(values.containerName || "").trim() || `${containerPrefix()}caddy`;
}

// Every instance with a public base URL set, resolved to where Caddy should
// actually send traffic for it — the same address the dashboard itself uses,
// so a route always matches whatever topology (VPN on or off) is live right
// now rather than something typed in once and left to drift.
function instanceRoutes() {
  const routes = [];

  for (const row of listComponents("instance")) {
    const values = JSON.parse(row.config_json);
    const raw = String(values.publicBaseUrl || "").trim();
    if (!raw) continue;

    let url;
    try {
      url = new URL(raw);
    } catch {
      continue; // Not a full URL — nothing to route on, same as leaving it blank.
    }
    if (!url.host) continue; // "host:port" parses with an empty host — same as unparseable.

    const target = instanceUrl(row.key, values);
    if (!target) continue;

    routes.push({ host: url.host, path: url.pathname.replace(/\/+$/, ""), target });
  }

  return routes;
}

// The Suite's own dashboard, published the same way an instance is: only when
// the operator has said where it is reached from outside. Only the host is
// used — the dashboard is root-absolute (/assets, /api), so it cannot live
// under a path prefix. `suiteTarget` is where Caddy reaches the Suite over
// Docker's DNS; without one there is nothing to route to.
function dashboardRoute(values, suiteTarget) {
  const raw = String(values.dashboardUrl || "").trim();
  if (!raw || !suiteTarget) return null;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!url.host) return null; // "host:port" parses with an empty host — same as unparseable.

  return { host: url.host, path: "", target: suiteTarget, dashboard: true };
}

function groupByHost(routes) {
  const byHost = new Map();
  for (const route of routes) {
    if (!byHost.has(route.host)) byHost.set(route.host, []);
    byHost.get(route.host).push(route);
  }
  return byHost;
}

// What the DNS challenge needs, resolved from the stored values: the directive
// that goes after `dns` in each site's tls block, the environment variables
// that directive references, the Caddy packages to add (`modules`), and an
// optional propagation delay. Null when DNS
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

  const delay = String(values.dnsPropagationDelay || "").trim();
  return { directive, env, modules, propagationDelay: GO_DURATION.test(delay) ? delay : null };
}

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

// Builds the actual Caddyfile text. One site block per distinct hostname —
// several instances can share a hostname on different paths, each becoming
// its own handle_path inside that one block; an instance alone on its
// hostname gets a plain reverse_proxy instead of a needless handle_path.
export function renderCaddyfile(values, suiteTarget) {
  const routes = instanceRoutes();
  const dashboard = dashboardRoute(values, suiteTarget);
  // Last, so within a shared hostname the path-based instance blocks match
  // before the dashboard's catch-all.
  if (dashboard) routes.push(dashboard);
  const byHost = groupByHost(routes);
  let file = "";

  const challenge = dnsChallenge(values);
  if ((values.tlsMode === "acme" || values.tlsMode === "dns") && values.acmeEmail) {
    file += `{\n\temail ${values.acmeEmail}\n}\n\n`;
  }

  if (byHost.size === 0) {
    file += `:80 {\n\trespond "StreamShare's Caddy is running, but no instance has a public base URL set yet." 200\n}\n`;
  } else {
    for (const [host, hostRoutes] of byHost) {
      file += `${host} {\n`;
      if ((values.tlsMode || "internal") === "internal") file += `\ttls internal\n`;
      if (challenge) {
        file += `\ttls {\n\t\tdns ${challenge.directive}\n`;
        if (challenge.propagationDelay) file += `\t\tpropagation_delay ${challenge.propagationDelay}\n`;
        file += `\t}\n`;
      }
      for (const route of hostRoutes) {
        if (route.path) {
          file += `\thandle_path ${route.path}* {\n\t\treverse_proxy ${route.target}\n\t}\n`;
        } else if (route.dashboard && hostRoutes.length > 1) {
          // Shares its hostname with path-based instances: an explicit handle
          // makes it the fallback that they are matched ahead of.
          file += `\thandle {\n\t\treverse_proxy ${route.target}\n\t}\n`;
        } else {
          file += `\treverse_proxy ${route.target}\n`;
        }
      }
      file += `}\n\n`;
    }
  }

  if (values.extraCaddyfile) file += `\n${values.extraCaddyfile}\n`;

  return file;
}

export async function renderCaddySpec(values) {
  const name = caddyContainerName(values);
  // Only ask Docker who we are when there is a dashboard to point at.
  const suiteTarget = values.dashboardUrl
    ? `http://${await getSelfContainerName()}:${process.env.PORT || 3000}`
    : undefined;
  const caddyfile = renderCaddyfile(values, suiteTarget);
  const challenge = dnsChallenge(values);

  const dir = ensureDirectory(componentDataDir(name));
  const caddyfilePath = path.join(dir, "Caddyfile");
  writeFileSync(caddyfilePath, caddyfile);
  const dataDir = ensureDirectory(dir, "data");
  const configDir = ensureDirectory(dir, "config");

  const networks = String(values.networks || NETWORKS_FIELD.default)
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);

  return {
    name,
    image: values.image || IMAGE_FIELD.default,
    env: {
      // The DNS provider's credentials, referenced from the Caddyfile as
      // {env.NAME} so the token itself never lands in a file on disk. Spread
      // first so nothing in it can shadow the hash below.
      ...(challenge?.env || {}),
      // Not read by Caddy — see this file's header for why it's here.
      CADDY_CONFIG_HASH: createHash("sha256").update(caddyfile).digest("hex"),
    },
    volumes: [`${caddyfilePath}:/etc/caddy/Caddyfile:ro`, `${dataDir}:/data`, `${configDir}:/config`],
    networks,
    ports: [
      { host: Number(values.httpPort || 80), container: 80, protocol: "tcp" },
      { host: Number(values.httpsPort || 443), container: 443, protocol: "tcp" },
    ],
    restartPolicy: "unless-stopped",
    ...(challenge ? { command: caddyStartCommand(challenge.modules) } : {}),
  };
}
