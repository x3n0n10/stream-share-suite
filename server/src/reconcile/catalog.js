// The catalog of component kinds the reconciler knows how to manage, and the
// edges between them.
//
// Phase 1 kept this as a two-entry object inside the routes file, which was
// fine when there was one component and no relationships. Two things changed
// it into a module of its own: components now have keys (several instances of
// one kind), and they now have edges (what must be applied before what, and
// what cannot survive what being replaced).
//
// Both edges are declared as data on the entry rather than discovered from a
// rendered spec, because a plan has to know the shape of the stack before it
// renders anything — including for components that do not exist yet.

import { GLUETUN_SCHEMA } from "../schema/gluetun.js";
import { renderGluetunSpec, GLUETUN_CONTAINER_NAME } from "./gluetun.js";
import { getBoolean } from "../store/settings.js";
import { componentId, listComponents } from "../store/components.js";

// Whether the stack routes its traffic through a VPN at all. This is one
// stack-wide setting rather than a per-instance choice: a StreamShare
// deployment shares one tunnel, and per-instance tunnels would mean a gluetun
// container each — more machinery than the case is worth.
//
// Defaults to on, which is what a phase 1 deployment already had. A fresh
// install is asked outright by the wizard in 2c.
export const VPN_ENABLED_SETTING = "stack.vpn_enabled";

export function isVpnEnabled() {
  return getBoolean(VPN_ENABLED_SETTING, true);
}

// Every kind the reconciler can manage. `present` decides whether a kind is
// part of the stack at all right now — distinct from whether it is configured,
// which is the schema's business.
const CATALOG = {
  gluetun: {
    kind: "gluetun",
    label: "Gluetun (VPN)",
    description:
      "The VPN tunnel. Every StreamShare instance, Caddy and UHF share its network namespace, so replacing it briefly takes them with it.",
    schema: GLUETUN_SCHEMA,
    render: renderGluetunSpec,
    singleton: true,
    containerName: () => GLUETUN_CONTAINER_NAME,
    present: () => isVpnEnabled(),
    // Nothing has to exist before gluetun, and nothing hosts its namespace.
    // Instances, Caddy and UHF fill both of these in from 2b.
    dependsOn: () => [],
    namespaceHost: () => null,
  },
};

export function getCatalogEntry(kind) {
  return CATALOG[kind] || null;
}

export function catalogKinds() {
  return Object.keys(CATALOG);
}

// The stack as it stands right now: one node per component that is part of it,
// each carrying the edges the graph needs. A singleton contributes exactly one
// node; a multi-instance kind contributes one per stored row.
//
// A kind whose `present` is false contributes nothing at all — which is how
// turning the VPN off removes gluetun from every plan rather than leaving it
// sitting there configured-but-ignored.
export function activeComponents() {
  const nodes = [];

  for (const entry of Object.values(CATALOG)) {
    if (!entry.present()) continue;

    const keys = entry.singleton ? [""] : listComponents(entry.kind).map((row) => row.key);

    for (const key of keys) {
      nodes.push({
        id: componentId(entry.kind, key),
        kind: entry.kind,
        key,
        label: entry.label,
        description: entry.description,
        schema: entry.schema,
        render: entry.render,
        containerName: entry.containerName(key),
        dependsOn: entry.dependsOn(key),
        namespaceHost: entry.namespaceHost(key),
      });
    }
  }

  return nodes;
}
