// The dependency graph and the cascade rule.
//
// These are pure functions on purpose — the cascade is the most dangerous rule
// in the reconciler and the least convenient to exercise against a real
// daemon, so it is proven here with plain objects instead of containers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { orderComponents, applyCascade, summarize } from "../src/reconcile/graph.js";

function node(id, { dependsOn = [], namespaceHost = null } = {}) {
  return { id, kind: id, key: "", label: id, dependsOn, namespaceHost };
}

function plan(id, action, { namespaceHost = null, ...rest } = {}) {
  return { id, kind: id, key: "", label: id, action, namespaceHost, cascadedFrom: null, warnings: [], ...rest };
}

const ids = (list) => list.map((item) => item.id);

// --- ordering ---------------------------------------------------------------

test("ordering an empty stack is an empty stack", () => {
  assert.deepEqual(orderComponents([]), []);
});

test("nodes with no edges keep the order they arrived in", () => {
  const nodes = [node("a"), node("b"), node("c")];
  assert.deepEqual(ids(orderComponents(nodes)), ["a", "b", "c"]);
});

test("a dependency is placed before the node that declares it", () => {
  const nodes = [node("instance", { dependsOn: ["postgres"] }), node("postgres")];
  assert.deepEqual(ids(orderComponents(nodes)), ["postgres", "instance"]);
});

test("a namespace host counts as a dependency without being declared twice", () => {
  const nodes = [node("caddy", { namespaceHost: "gluetun" }), node("gluetun")];
  assert.deepEqual(ids(orderComponents(nodes)), ["gluetun", "caddy"]);
});

test("orders a realistic stack: gluetun and postgres before the instances inside them", () => {
  const nodes = [
    node("instance:p1", { dependsOn: ["postgres"], namespaceHost: "gluetun" }),
    node("caddy", { namespaceHost: "gluetun" }),
    node("instance:p2", { dependsOn: ["postgres"], namespaceHost: "gluetun" }),
    node("gluetun"),
    node("postgres"),
  ];

  const order = ids(orderComponents(nodes));

  assert.ok(order.indexOf("gluetun") < order.indexOf("instance:p1"));
  assert.ok(order.indexOf("gluetun") < order.indexOf("caddy"));
  assert.ok(order.indexOf("postgres") < order.indexOf("instance:p2"));
  assert.equal(order.length, 5);
});

test("ordering is deterministic across repeated runs, not merely valid", () => {
  const build = () => [
    node("c", { dependsOn: ["a"] }),
    node("b", { dependsOn: ["a"] }),
    node("a"),
    node("d", { dependsOn: ["a"] }),
  ];
  assert.deepEqual(ids(orderComponents(build())), ids(orderComponents(build())));
});

test("an edge pointing at a component that is not in the stack is ignored", () => {
  // Exactly what happens when the VPN is switched off: an instance still
  // declares gluetun as its namespace host, but gluetun is no longer a node.
  const nodes = [node("instance:p1", { namespaceHost: "gluetun" })];
  assert.deepEqual(ids(orderComponents(nodes)), ["instance:p1"]);
});

test("a dependency cycle throws rather than silently dropping an edge", () => {
  const nodes = [node("a", { dependsOn: ["b"] }), node("b", { dependsOn: ["a"] })];
  assert.throws(() => orderComponents(nodes), /cycle/i);
});

// --- the cascade ------------------------------------------------------------

test("recreating a namespace host turns a matching container into a recreate", () => {
  const result = applyCascade([
    plan("gluetun", "recreate"),
    plan("caddy", "noop", { namespaceHost: "gluetun" }),
  ]);

  const caddy = result.find((p) => p.id === "caddy");
  assert.equal(caddy.action, "recreate");
  assert.equal(caddy.cascadedFrom, "gluetun");
  assert.match(caddy.reason, /network namespace/i);
});

test("creating a namespace host cascades too — anything already inside it is stranded", () => {
  const result = applyCascade([
    plan("gluetun", "create"),
    plan("caddy", "noop", { namespaceHost: "gluetun" }),
  ]);

  assert.equal(result.find((p) => p.id === "caddy").action, "recreate");
});

test("a namespace host that is not being touched cascades nothing", () => {
  for (const hostAction of ["noop", "adopt"]) {
    const result = applyCascade([
      plan("gluetun", hostAction),
      plan("caddy", "noop", { namespaceHost: "gluetun" }),
    ]);
    assert.equal(
      result.find((p) => p.id === "caddy").action,
      "noop",
      `host action ${hostAction} must not cascade`
    );
  }
});

test("a component with no namespace host is never cascaded into", () => {
  const result = applyCascade([plan("gluetun", "recreate"), plan("postgres", "noop")]);
  assert.equal(result.find((p) => p.id === "postgres").action, "noop");
});

test("a component that was going to be created anyway stays a create", () => {
  const result = applyCascade([
    plan("gluetun", "recreate"),
    plan("caddy", "create", { namespaceHost: "gluetun" }),
  ]);
  assert.equal(result.find((p) => p.id === "caddy").action, "create");
});

test("a component recreating on its own merits records that it was also cascaded", () => {
  const result = applyCascade([
    plan("gluetun", "recreate"),
    plan("caddy", "recreate", { namespaceHost: "gluetun" }),
  ]);

  const caddy = result.find((p) => p.id === "caddy");
  assert.equal(caddy.action, "recreate");
  assert.equal(caddy.cascadedFrom, "gluetun");
});

test("an adopted container in a replaced namespace is warned about, never recreated", () => {
  const result = applyCascade([
    plan("gluetun", "recreate"),
    plan("uhf", "adopt", { namespaceHost: "gluetun" }),
  ]);

  const uhf = result.find((p) => p.id === "uhf");
  assert.equal(uhf.action, "adopt", "the Suite must not take over a container it was not asked to");
  assert.equal(uhf.warnings.length, 1);
  assert.match(uhf.warnings[0], /disconnect/i);
});

test("the cascade propagates down a chain in one pass", () => {
  const result = applyCascade([
    plan("gluetun", "recreate"),
    plan("middle", "noop", { namespaceHost: "gluetun" }),
    plan("leaf", "noop", { namespaceHost: "middle" }),
  ]);

  assert.equal(result.find((p) => p.id === "middle").action, "recreate");
  assert.equal(result.find((p) => p.id === "leaf").action, "recreate");
  assert.equal(result.find((p) => p.id === "leaf").cascadedFrom, "middle");
});

test("a takeover cascades the same way a recreate does", () => {
  const result = applyCascade([
    plan("gluetun", "takeover"),
    plan("caddy", "noop", { namespaceHost: "gluetun" }),
  ]);
  assert.equal(result.find((p) => p.id === "caddy").action, "recreate");
});

test("the input plans are not mutated", () => {
  const caddy = plan("caddy", "noop", { namespaceHost: "gluetun" });
  applyCascade([plan("gluetun", "recreate"), caddy]);
  assert.equal(caddy.action, "noop");
  assert.equal(caddy.cascadedFrom, null);
});

// --- summary ----------------------------------------------------------------

test("the summary counts what will happen, not what was asked for", () => {
  const summary = summarize(
    applyCascade([
      plan("postgres", "noop"),
      plan("gluetun", "recreate"),
      plan("i1", "noop", { namespaceHost: "gluetun" }),
      plan("i2", "noop", { namespaceHost: "gluetun" }),
      plan("uhf", "adopt", { namespaceHost: "gluetun" }),
    ])
  );

  assert.equal(summary.total, 5);
  assert.equal(summary.changes, 3, "gluetun plus the two cascaded instances");
  assert.equal(summary.restarts, 3);
  assert.equal(summary.cascaded, 2);
  assert.equal(summary.warnings, 1, "the adopted container's disconnection warning");
});
