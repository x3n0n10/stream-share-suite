// Label conventions that make every container the reconciler touches
// self-describing. See the blueprint's invariants table: `managed` is what
// lets the reconciler tell "ours" from "everything else on this host" — a
// container without it is never created, recreated, or removed, no matter
// what its name is.

export const LABEL_MANAGED = "streamshare.suite.managed";
export const LABEL_COMPONENT = "streamshare.suite.component";
export const LABEL_SPEC_HASH = "streamshare.suite.spec-hash";

export function managedLabels(kind, specHash) {
  return {
    [LABEL_MANAGED]: "true",
    [LABEL_COMPONENT]: kind,
    [LABEL_SPEC_HASH]: specHash,
  };
}

export function isManaged(labels) {
  return !!labels && labels[LABEL_MANAGED] === "true";
}
