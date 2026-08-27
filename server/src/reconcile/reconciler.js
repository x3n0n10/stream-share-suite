// The core apply engine: given a desired spec, decide what — if anything —
// needs to happen to a real container, and do it.
//
// Five outcomes, and the third and fifth are what make this safe to point at a
// stack someone is already running:
//
//   create   — no container with this name exists yet.
//   noop     — one exists, carries our labels, and its spec hash matches.
//   recreate — one exists, carries our labels, but the hash has changed.
//   adopt    — one exists under the expected name but carries none of our
//              labels — a foreign container, almost always a real one from a
//              hand-written compose file. The default is to leave it running
//              untouched and just remember that it satisfies this component;
//              only an explicit takeover stops and replaces it. Docker labels
//              are immutable after creation, so there is no way to "adopt in
//              place" — recognising it without touching it is the only safe
//              reading of what the blueprint calls adopt-by-label.
//   orphaned — a container we created, for a component that is no longer part
//              of the stack (the VPN was switched off, an instance removed).
//              Never removed automatically: the plan surfaces it and removing
//              it is its own confirmed action.

import {
  inspectContainer,
  listContainers,
  createContainer,
  startContainer,
  stopContainer,
  removeContainer,
  connectNetwork,
} from "../docker/client.js";
import { computeSpecHash, toCreatePayload } from "../docker/spec.js";
import { LABEL_MANAGED, LABEL_SPEC_HASH, managedLabels, isManaged, componentOf } from "../docker/labels.js";
import { setAdoptedContainer, clearAdoption, getComponentValues, componentId } from "../store/components.js";
import { validate } from "../schema/registry.js";
import { activeComponents, inactiveComponents } from "./catalog.js";
import { orderComponents, applyCascade, summarize } from "./graph.js";

// Plans one component against what is actually deployed. `node` carries the
// component's identity and its edges; the edges are copied onto the plan so
// the cascade pass can work from plans alone.
export async function planComponent(node, spec) {
  const desiredHash = computeSpecHash(spec);
  const existing = await inspectContainer(spec.name);

  const base = {
    id: node.id,
    kind: node.kind,
    key: node.key || "",
    label: node.label,
    namespaceHost: node.namespaceHost || null,
    cascadedFrom: null,
    warnings: [],
    spec,
    desiredHash,
  };

  if (!existing) {
    return { ...base, action: "create", reason: `No container named ${spec.name} exists yet` };
  }

  const labels = existing.Config?.Labels || {};

  if (!isManaged(labels)) {
    return {
      ...base,
      action: "adopt",
      reason: "Running since before the Suite — never touched without a takeover",
      containerId: existing.Id,
    };
  }

  if (labels[LABEL_SPEC_HASH] === desiredHash) {
    return {
      ...base,
      action: "noop",
      reason: "Matches the saved configuration",
      containerId: existing.Id,
    };
  }

  return {
    ...base,
    action: "recreate",
    reason: "The saved configuration has changed",
    containerId: existing.Id,
    previousHash: labels[LABEL_SPEC_HASH],
  };
}

// Managed containers that no longer correspond to anything in the stack.
//
// Found by label rather than by name, because the whole point is to catch
// something whose component the Suite has forgotten about — there is no
// desired spec left to derive a name from.
async function findOrphans(activeIds) {
  const containers = await listContainers({
    all: true,
    filters: { label: [`${LABEL_MANAGED}=true`] },
  });

  return containers
    .map((container) => {
      const component = componentOf(container.Labels || {});
      if (!component) return null;

      const id = componentId(component.kind, component.key);
      if (activeIds.has(id)) return null;

      return {
        id,
        kind: component.kind,
        key: component.key,
        label: component.kind,
        action: "orphaned",
        reason: "The Suite created this, but it is no longer part of the stack",
        containerId: container.Id,
        containerName: (container.Names || [])[0]?.replace(/^\//, "") || container.Id,
        namespaceHost: null,
        cascadedFrom: null,
        warnings: [],
      };
    })
    .filter(Boolean);
}

// Containers belonging to switched-off components that are still running.
//
// The orphan pass above only finds containers the Suite created, which is
// right: an orphan is something we made and no longer want. But a container
// the Suite merely adopted — someone's own from a compose file — carries none
// of our labels, so switching its component off would otherwise make it vanish
// from the plan entirely while it carries on running. An empty screen is the
// wrong way to say "your VPN container is still up and we are not touching
// it", so it gets a row of its own.
async function findDisabled(nodes) {
  const rows = [];

  for (const node of nodes) {
    if (!node.containerName) continue;

    const existing = await inspectContainer(node.containerName);
    if (!existing) continue;

    // A managed one is already reported as an orphan by the pass above;
    // reporting it twice would be worse than not reporting it at all.
    if (isManaged(existing.Config?.Labels || {})) continue;

    rows.push({
      id: node.id,
      kind: node.kind,
      key: node.key || "",
      label: node.label,
      action: "disabled",
      reason: "Switched off, but this container is still running. The Suite did not create it and has left it alone.",
      containerId: existing.Id,
      containerName: node.containerName,
      namespaceHost: null,
      cascadedFrom: null,
      warnings: [],
    });
  }

  return rows;
}

// The whole stack, in dependency order, with the cascade applied.
//
// A component that is present but not yet fully configured gets an
// "incomplete" row rather than being silently skipped: leaving it out would
// make the plan claim the stack is fine when a required field is empty.
export async function planStack() {
  const nodes = orderComponents(activeComponents());
  const plans = [];

  for (const node of nodes) {
    const values = getComponentValues(node.kind, node.key);
    const errors = validate(node.schema, values);

    if (errors.length > 0) {
      plans.push({
        id: node.id,
        kind: node.kind,
        key: node.key || "",
        label: node.label,
        action: "incomplete",
        reason: `Not configured yet — ${errors[0].message}`,
        errors,
        namespaceHost: node.namespaceHost || null,
        cascadedFrom: null,
        warnings: [],
      });
      continue;
    }

    plans.push(await planComponent(node, await node.render(values)));
  }

  const cascaded = applyCascade(plans);
  const orphans = await findOrphans(new Set(nodes.map((node) => node.id)));
  const disabled = await findDisabled(inactiveComponents());
  const all = [...cascaded, ...orphans, ...disabled];

  return { plans: all, summary: summarize(all) };
}

// Executes one plan, narrating progress through `log`. Returns the container
// id the component now runs as (or already ran as, for noop/adopt).
export async function applyPlan(plan, { log = () => {}, takeover = false } = {}) {
  const { action, kind, key, spec, desiredHash } = plan;

  if (action === "incomplete") {
    log(`${plan.label} is not fully configured — skipped.`);
    return null;
  }

  if (action === "orphaned") {
    log(`${plan.containerName} is orphaned. Removing it is a separate action — leaving it alone.`);
    return plan.containerId;
  }

  if (action === "disabled") {
    log(`${plan.containerName} belongs to a switched-off component and is not managed by the Suite — leaving it alone.`);
    return plan.containerId;
  }

  if (action === "noop") {
    log(`${spec.name} already matches the desired configuration.`);
    return plan.containerId;
  }

  if (action === "adopt" && !takeover) {
    log(`Found an existing container named "${spec.name}" without the Suite's labels — adopting without recreating.`);
    log("It stays exactly as it is until you explicitly ask the Suite to take over.");
    for (const warning of plan.warnings || []) log(`Warning: ${warning}`);
    setAdoptedContainer(kind, plan.containerId, key);
    return plan.containerId;
  }

  if (action === "adopt" && takeover) {
    log(`Taking over "${spec.name}": stopping and removing the unmanaged container.`);
    await stopContainer(plan.containerId, { timeoutSeconds: 30 });
    await removeContainer(plan.containerId, { force: true });
    clearAdoption(kind, key);
  }

  if (action === "recreate") {
    const why = plan.cascadedFrom
      ? `${plan.cascadedFrom} was replaced, taking its network namespace with it`
      : `configuration changed (${(plan.previousHash || "").slice(0, 12)} -> ${desiredHash.slice(0, 12)})`;
    log(`Recreating "${spec.name}" — ${why}.`);
    log("Stopping the current container...");
    await stopContainer(plan.containerId, { timeoutSeconds: 30 });
    log("Removing it...");
    await removeContainer(plan.containerId, { force: true });
  }

  log(`Creating "${spec.name}"...`);
  const labels = managedLabels(kind, desiredHash, key);
  const created = await createContainer(spec.name, toCreatePayload(spec, { labels }));

  for (const networkName of (spec.networks || []).slice(1)) {
    log(`Joining network "${networkName}"...`);
    await connectNetwork(networkName, created.Id);
  }

  log(`Starting "${spec.name}"...`);
  await startContainer(created.Id);

  log("Done.");
  return created.Id;
}

// The actions a stack apply carries out. Everything else is either nothing to
// do (noop), not ours to touch (adopt, orphaned) or not ready (incomplete).
//
// Adopt is deliberately not here even though applyPlan can handle it: on the
// stack path there is genuinely nothing to do to a foreign container, and
// counting it would make the button promise a change it is not going to make.
// Taking one over is an explicit per-component action.
const APPLIES = new Set(["create", "recreate"]);

// Applies a whole stack plan in order, stopping at the first failure.
//
// Stopping rather than continuing is the right call for a dependency-ordered
// list: if gluetun fails to come back, recreating the four containers that
// were going to join its namespace only produces four more broken things.
export async function applyStack(plans, { log = () => {} } = {}) {
  const actionable = plans.filter((plan) => APPLIES.has(plan.action));

  if (actionable.length === 0) {
    log("Nothing to apply — the stack already matches its configuration.");
    return;
  }

  let done = 0;
  for (const plan of actionable) {
    done += 1;
    log(`[${done}/${actionable.length}] ${plan.label}`);
    await applyPlan(plan, { log });
  }

  log(`Applied ${actionable.length} change${actionable.length === 1 ? "" : "s"}.`);
}

// Removes an orphaned container. Separate from applyStack on purpose: nothing
// the reconciler does automatically should ever destroy a container it can no
// longer describe.
export async function removeOrphan(containerId, { log = () => {} } = {}) {
  log(`Stopping ${containerId}...`);
  await stopContainer(containerId, { timeoutSeconds: 30 });
  log("Removing it...");
  await removeContainer(containerId, { force: true });
  log("Done.");
}
