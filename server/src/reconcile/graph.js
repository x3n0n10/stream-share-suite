// Ordering and the cascade rule — the two things that make applying a whole
// stack different from applying one component four times.
//
// Everything here is pure: nodes in, ordered nodes or rewritten plans out, no
// Docker and no store. That is deliberate. The cascade is the rule most
// expensive to get wrong and least convenient to exercise against a real
// daemon, so it is written to be provable in a unit test instead.

// Two kinds of edge, and they mean different things:
//
//   dependsOn      — must be applied before this one. Ordering only.
//   namespaceHost  — this container runs inside that one's network namespace
//                    (Docker's `network_mode: service:x`). Ordering, AND the
//                    cascade: the namespace disappears when its host is
//                    replaced, and Docker does not re-attach anything to the
//                    new one. A container left behind has no network at all.
//
// A namespaceHost is therefore also a dependency; callers do not have to
// declare it twice.
function edgesOf(node) {
  const edges = new Set(node.dependsOn || []);
  if (node.namespaceHost) edges.add(node.namespaceHost);
  return [...edges];
}

// Kahn's algorithm, with ties broken by the order nodes arrived in so the
// result is stable rather than merely valid — a plan whose rows reshuffle
// between two identical runs would be unreadable.
//
// Throws on a cycle. A cycle is a bug in the catalog, not something an
// operator can enter, so failing loudly beats silently dropping an edge.
export function orderComponents(nodes) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const remaining = new Map(
    nodes.map((node) => [node.id, edgesOf(node).filter((id) => byId.has(id))])
  );

  const ordered = [];
  const placed = new Set();

  while (ordered.length < nodes.length) {
    const next = nodes.find(
      (node) => !placed.has(node.id) && remaining.get(node.id).every((id) => placed.has(id))
    );

    if (!next) {
      const stuck = nodes.filter((node) => !placed.has(node.id)).map((node) => node.id);
      throw new Error(`Dependency cycle between components: ${stuck.join(", ")}`);
    }

    ordered.push(next);
    placed.add(next.id);
  }

  return ordered;
}

// Actions that mean "a container came into being where a different one (or
// none) used to be" — which is exactly when anything sharing its namespace is
// left stranded.
const REPLACING = new Set(["create", "recreate", "takeover"]);

// Rewrites an ordered list of plans so that everything sharing a replaced
// container's namespace is replaced too.
//
// Runs over plans in dependency order, so a host is always decided before the
// things inside it — which also means a cascade propagates through a chain
// without needing a second pass.
//
// Three outcomes for a node whose host is being replaced:
//
//   already creating  — nothing to do; it is new anyway.
//   managed, exists   — becomes a recreate, marked as a consequence rather
//                       than a choice, so the plan can show it as one.
//   adopted, foreign  — left alone, because recreating a container the Suite
//                       does not own would be a takeover nobody asked for.
//                       It gets a warning instead: this WILL break it, and the
//                       operator is the one who has to decide what to do.
export function applyCascade(orderedPlans) {
  const byId = new Map();
  const result = [];

  for (const plan of orderedPlans) {
    const host = plan.namespaceHost ? byId.get(plan.namespaceHost) : null;
    const hostIsReplaced = host && REPLACING.has(host.action);

    let next = plan;

    if (hostIsReplaced && plan.action === "noop") {
      next = {
        ...plan,
        action: "recreate",
        reason: `Shares ${host.label}'s network namespace`,
        cascadedFrom: host.id,
      };
    } else if (hostIsReplaced && plan.action === "recreate") {
      // It was going to be recreated on its own merits; say both, because
      // "you changed this" and "it had to move anyway" are different facts.
      next = { ...plan, cascadedFrom: host.id };
    } else if (hostIsReplaced && plan.action === "adopt") {
      next = {
        ...plan,
        warnings: [
          ...(plan.warnings || []),
          `${host.label} is being replaced, which will disconnect this container. ` +
            `The Suite will not touch it — restart or take it over yourself afterwards.`,
        ],
      };
    }

    byId.set(next.id, next);
    result.push(next);
  }

  return result;
}

// Actions that actually touch a container when applied. Deliberately an
// allowlist: "everything except no-op" would quietly count an orphan or an
// unconfigured component as work the Apply button is about to do, and the
// header's whole job is to be the number you can trust before pressing it.
const MUTATING = new Set(["create", "recreate", "takeover"]);

// What the plan screen puts in its header. Counted after the cascade, so it
// reflects what will actually happen rather than what was asked for.
export function summarize(plans) {
  return {
    total: plans.length,
    changes: plans.filter((plan) => MUTATING.has(plan.action)).length,
    restarts: plans.filter((plan) => plan.action === "recreate").length,
    cascaded: plans.filter((plan) => plan.cascadedFrom).length,
    orphans: plans.filter((plan) => plan.action === "orphaned").length,
    disabled: plans.filter((plan) => plan.action === "disabled").length,
    incomplete: plans.filter((plan) => plan.action === "incomplete").length,
    warnings: plans.flatMap((plan) => plan.warnings || []).length,
  };
}
