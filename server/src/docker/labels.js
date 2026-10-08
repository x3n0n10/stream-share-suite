// Label conventions that make every container the reconciler touches
// self-describing. See the blueprint's invariants table: `managed` is what
// lets the reconciler tell "ours" from "everything else on this host" — a
// container without it is never created, recreated, or removed, no matter
// what its name is.

import { containerPrefix } from "../reconcile/prefix.js";

export const LABEL_MANAGED = "streamshare.suite.managed";
export const LABEL_COMPONENT = "streamshare.suite.component";
export const LABEL_COMPONENT_KEY = "streamshare.suite.component-key";
export const LABEL_SPEC_HASH = "streamshare.suite.spec-hash";

// Which Suite created a container: the value is that Suite's
// SUITE_CONTAINER_PREFIX, which is already what must differ between two
// Suites on one Docker host. Without it every Suite sees every other Suite's
// managed containers as its own orphans.
export const LABEL_SUITE = "streamshare.suite.instance";

// The kind and the key are separate labels rather than one composite so that
// "every instance" stays a single label filter against the Docker API. The key
// is empty for a singleton, which is also what a phase 1 container — created
// before this label existed — reads as.
//
// None of these are part of the spec hash: they are attached at apply time,
// and hashing them would make adding a label look like a configuration change
// and recreate every managed container once. LABEL_SUITE, like the others, is
// not part of the spec hash.
export function managedLabels(kind, specHash, key = "") {
  return {
    [LABEL_MANAGED]: "true",
    [LABEL_SUITE]: containerPrefix(),
    [LABEL_COMPONENT]: kind,
    [LABEL_COMPONENT_KEY]: key,
    [LABEL_SPEC_HASH]: specHash,
  };
}

export function isManaged(labels) {
  return !!labels && labels[LABEL_MANAGED] === "true";
}

// True only for a managed container that names a *different* Suite. A managed
// container with no instance label predates the label and is treated as this
// Suite's own — otherwise every existing install would see its whole stack
// turn foreign on upgrade. (A label cannot be added to a running container;
// it arrives the next time the container is recreated.)
export function belongsToAnotherSuite(labels) {
  if (!isManaged(labels)) return false;
  const owner = labels[LABEL_SUITE];
  return owner !== undefined && owner !== containerPrefix();
}

export function componentOf(labels) {
  if (!isManaged(labels)) return null;
  return {
    kind: labels[LABEL_COMPONENT] || "",
    key: labels[LABEL_COMPONENT_KEY] || "",
  };
}
