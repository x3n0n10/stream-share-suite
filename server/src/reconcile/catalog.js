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
import { POSTGRES_SCHEMA } from "../schema/postgres.js";
import { INSTANCE_SCHEMA } from "../schema/instance.js";
import { renderGluetunSpec, gluetunContainerName } from "./gluetun.js";
import {
  renderPostgresSpec,
  postgresContainerName,
  isManaged as isPostgresManaged,
  connectionTarget as postgresTarget,
} from "./postgres.js";
import { renderInstanceSpec, instanceContainerName } from "./instance.js";
import { prepareInstance } from "./provisioning.js";
import { getBoolean } from "../store/settings.js";
import { getDataPath, getCachePath, validatePath } from "../store/paths.js";
import { componentId, listComponents, getComponentValues } from "../store/components.js";

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
      "The VPN tunnel. Every StreamShare instance shares its network namespace and is published through it, so replacing it briefly takes them with it.",
    schema: GLUETUN_SCHEMA,
    render: renderGluetunSpec,
    singleton: true,
    containerName: () => gluetunContainerName(getComponentValues("gluetun")),
    present: () => isVpnEnabled(),
    // Nothing has to exist before gluetun, and nothing hosts its namespace.
    dependsOn: () => [],
    namespaceHost: () => null,
  },

  postgres: {
    kind: "postgres",
    label: "PostgreSQL",
    description:
      "Where every instance keeps its history, VOD index and aliases. Each instance gets a database of its own rather than sharing one.",
    schema: POSTGRES_SCHEMA,
    render: renderPostgresSpec,
    singleton: true,
    containerName: () => postgresContainerName(getComponentValues("postgres")),
    // An external server is configured here but not run by us, so there is no
    // container to reconcile and it contributes no node.
    present: () => isPostgresManaged(getComponentValues("postgres")),
    ready: () => validatePath(getDataPath(), "The stack data path"),
    dependsOn: () => [],
    // Deliberately not inside the VPN: the database has no reason to egress
    // through the tunnel, and putting it there would make every VPN change
    // restart it.
    namespaceHost: () => null,
  },

  instance: {
    kind: "instance",
    label: "StreamShare instance",
    description: "One IPTV provider, shared with your users.",
    schema: INSTANCE_SCHEMA,
    render: renderInstanceSpec,
    singleton: false,
    containerName: (key) => instanceContainerName(key, getComponentValues("instance", key)),
    present: () => true,
    ready: () =>
      validatePath(getDataPath(), "The stack data path") ||
      validatePath(getCachePath(), "The cache path") ||
      // An external server contributes no node, so the dependency check cannot
      // catch one that was never filled in. Without this an instance plans a
      // create and then fails mid-apply against a host that does not exist.
      (postgresTarget(getComponentValues("postgres")).host
        ? null
        : "No PostgreSQL server is configured yet."),
    // The database must exist before an instance that stores its state there.
    // An external postgres is not a node, so this edge simply finds nothing to
    // order against — which orderComponents already tolerates.
    dependsOn: () => ["postgres"],
    // Runs before the container is created or recreated, never before a noop:
    // an instance needs its database to exist before it first connects.
    prepare: (key, values, opts) => prepareInstance(key, values, opts),
    // With the VPN on, an instance runs inside gluetun's network namespace and
    // does not survive it being replaced. This is the edge the cascade exists
    // for, and 2b is where it starts firing.
    namespaceHost: () => (isVpnEnabled() ? "gluetun" : null),
  },
};

export function getCatalogEntry(kind) {
  return CATALOG[kind] || null;
}

export function catalogKinds() {
  return Object.keys(CATALOG);
}

// Every component the Suite knows of, whether or not it is currently part of
// the stack. A singleton contributes exactly one node; a multi-instance kind
// contributes one per stored row.
//
// `present` is what a switched-off kind sets to false. Switched-off components
// are still enumerated rather than dropped here, because "gluetun is off and
// a container by that name is still running" is something the plan has to be
// able to say — dropping them at the source is what made it silent.
export function componentNodes() {
  const nodes = [];

  for (const entry of Object.values(CATALOG)) {
    const present = entry.present();
    const keys = entry.singleton ? [""] : listComponents(entry.kind).map((row) => row.key);

    for (const key of keys) {
      const stored = entry.singleton ? null : getComponentValues(entry.kind, key);
      nodes.push({
        id: componentId(entry.kind, key),
        kind: entry.kind,
        key,
        label: stored?.displayName || entry.label,
        description: entry.description,
        schema: entry.schema,
        render: entry.render,
        containerName: entry.containerName(key),
        dependsOn: entry.dependsOn(key),
        namespaceHost: entry.namespaceHost(key),
        prepare: entry.prepare || null,
        ready: entry.ready || null,
        present,
      });
    }
  }

  return nodes;
}

// The stack as it stands right now — the components a plan actually acts on.
export function activeComponents() {
  return componentNodes().filter((node) => node.present);
}

// Configured components that are currently switched off. A plan reports these
// only when something of theirs is still running on the host.
export function inactiveComponents() {
  return componentNodes().filter((node) => !node.present);
}
