// The core apply engine: given a desired spec, decide what — if anything —
// needs to happen to a real container, and do it.
//
// Four outcomes, and the third is the one that makes this safe to point at a
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

import {
  inspectContainer,
  createContainer,
  startContainer,
  stopContainer,
  removeContainer,
  connectNetwork,
} from "../docker/client.js";
import { computeSpecHash, toCreatePayload } from "../docker/spec.js";
import { LABEL_SPEC_HASH, managedLabels, isManaged } from "../docker/labels.js";
import { setAdoptedContainer, clearAdoption } from "../store/components.js";

export async function planComponent(kind, spec) {
  const desiredHash = computeSpecHash(spec);
  const existing = await inspectContainer(spec.name);

  if (!existing) {
    return { action: "create", kind, spec, desiredHash };
  }

  const labels = existing.Config?.Labels || {};
  if (!isManaged(labels)) {
    return { action: "adopt", kind, spec, desiredHash, containerId: existing.Id };
  }

  if (labels[LABEL_SPEC_HASH] === desiredHash) {
    return { action: "noop", kind, spec, desiredHash, containerId: existing.Id };
  }

  return {
    action: "recreate",
    kind,
    spec,
    desiredHash,
    containerId: existing.Id,
    previousHash: labels[LABEL_SPEC_HASH],
  };
}

// Executes a plan, narrating progress through `log` so a caller can stream it
// to whoever is watching an apply happen. Returns the container id the
// component now runs as (or already ran as, for noop/adopt-without-takeover).
export async function applyPlan(plan, { log = () => {}, takeover = false } = {}) {
  const { action, kind, spec, desiredHash } = plan;

  if (action === "noop") {
    log(`${spec.name} already matches the desired configuration.`);
    return plan.containerId;
  }

  if (action === "adopt" && !takeover) {
    log(`Found an existing container named "${spec.name}" without the Suite's labels — adopting without recreating.`);
    log("It stays exactly as it is until you explicitly ask the Suite to take over.");
    setAdoptedContainer(kind, plan.containerId);
    return plan.containerId;
  }

  if (action === "adopt" && takeover) {
    log(`Taking over "${spec.name}": stopping and removing the unmanaged container.`);
    await stopContainer(plan.containerId, { timeoutSeconds: 30 });
    await removeContainer(plan.containerId, { force: true });
    clearAdoption(kind);
  }

  if (action === "recreate") {
    log(
      `Configuration changed (${(plan.previousHash || "").slice(0, 12)} -> ${desiredHash.slice(0, 12)}). Recreating "${spec.name}".`
    );
    log("Stopping the current container...");
    await stopContainer(plan.containerId, { timeoutSeconds: 30 });
    log("Removing it...");
    await removeContainer(plan.containerId, { force: true });
  }

  log(`Creating "${spec.name}"...`);
  const labels = managedLabels(kind, desiredHash);
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
