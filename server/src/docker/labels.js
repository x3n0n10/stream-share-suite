// Label conventions that make every container the reconciler touches
// self-describing. See the blueprint's invariants table: `managed` is what
// lets the reconciler tell "ours" from "everything else on this host" — a
// container without it is never created, recreated, or removed, no matter
// what its name is.

export const LABEL_MANAGED = "streamshare.suite.managed";
export const LABEL_COMPONENT = "streamshare.suite.component";
export const LABEL_COMPONENT_KEY = "streamshare.suite.component-key";
export const LABEL_SPEC_HASH = "streamshare.suite.spec-hash";

// The kind and the key are separate labels rather than one composite so that
// "every instance" stays a single label filter against the Docker API. The key
// is empty for a singleton, which is also what a phase 1 container — created
// before this label existed — reads as.
//
// None of these are part of the spec hash: they are attached at apply time,
// and hashing them would make adding a label look like a configuration change
// and recreate every managed container once.
export function managedLabels(kind, specHash, key = "") {
  return {
    [LABEL_MANAGED]: "true",
    [LABEL_COMPONENT]: kind,
    [LABEL_COMPONENT_KEY]: key,
    [LABEL_SPEC_HASH]: specHash,
  };
}

export function isManaged(labels) {
  return !!labels && labels[LABEL_MANAGED] === "true";
}

export function componentOf(labels) {
  if (!isManaged(labels)) return null;
  return {
    kind: labels[LABEL_COMPONENT] || "",
    key: labels[LABEL_COMPONENT_KEY] || "",
  };
}
