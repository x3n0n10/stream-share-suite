// Renders the Caddy component to a container spec, including the Caddyfile
// itself — Caddy has no environment-variable configuration surface, so
// unlike every other component here the render step also writes a real file
// to the bind-mounted config directory rather than only building an env map.
//
// That file's content is derived data (which instances have a public base
// URL right now), the same way gluetun's FIREWALL_OUTBOUND_SUBNETS or its
// published ports are — see catalog.js and gluetun.js. Writing it during
// render is exactly as safe as those: idempotent, and re-run on every plan.
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
import { listComponents, getComponentValues } from "../store/components.js";
import { componentDataDir, ensureDirectory } from "../store/paths.js";
import { instanceUrl } from "./instance.js";
import { containerPrefix } from "./prefix.js";

const NETWORKS_FIELD = CADDY_SCHEMA.fields.find((f) => f.key === "networks");

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

    const target = instanceUrl(row.key, values);
    if (!target) continue;

    routes.push({ host: url.host, path: url.pathname.replace(/\/+$/, ""), target });
  }

  return routes;
}

function groupByHost(routes) {
  const byHost = new Map();
  for (const route of routes) {
    if (!byHost.has(route.host)) byHost.set(route.host, []);
    byHost.get(route.host).push(route);
  }
  return byHost;
}

// Builds the actual Caddyfile text. One site block per distinct hostname —
// several instances can share a hostname on different paths, each becoming
// its own handle_path inside that one block; an instance alone on its
// hostname gets a plain reverse_proxy instead of a needless handle_path.
export function renderCaddyfile(values) {
  const byHost = groupByHost(instanceRoutes());
  let file = "";

  if (values.tlsMode === "acme" && values.acmeEmail) {
    file += `{\n\temail ${values.acmeEmail}\n}\n\n`;
  }

  if (byHost.size === 0) {
    file += `:80 {\n\trespond "StreamShare's Caddy is running, but no instance has a public base URL set yet." 200\n}\n`;
  } else {
    for (const [host, hostRoutes] of byHost) {
      file += `${host} {\n`;
      if ((values.tlsMode || "internal") === "internal") file += `\ttls internal\n`;
      for (const route of hostRoutes) {
        file += route.path
          ? `\thandle_path ${route.path}* {\n\t\treverse_proxy ${route.target}\n\t}\n`
          : `\treverse_proxy ${route.target}\n`;
      }
      file += `}\n\n`;
    }
  }

  if (values.extraCaddyfile) file += `\n${values.extraCaddyfile}\n`;

  return file;
}

export async function renderCaddySpec(values) {
  const name = caddyContainerName(values);
  const caddyfile = renderCaddyfile(values);

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
    image: values.image || "caddy:2-alpine",
    env: {
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
  };
}
