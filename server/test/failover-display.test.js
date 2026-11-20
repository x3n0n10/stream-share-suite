import { test } from "node:test";
import assert from "node:assert/strict";
import { isLentViewer, withoutLentViewers } from "../src/reconcile/failover.js";

test("isLentViewer matches failover: identities only", () => {
  assert.equal(isLentViewer("failover:Main/3"), true);
  assert.equal(isLentViewer("alice"), false);
  assert.equal(isLentViewer("10.0.0.5"), false);
  assert.equal(isLentViewer(undefined), false);
});

test("withoutLentViewers drops lent-only streams, keeps mixed and empty ones", () => {
  const summary = [
    { stream_id: "1", viewer_count: 1, viewers: ["failover:Main/1"] },
    { stream_id: "2", viewer_count: 1, viewers: [{ id: "failover:Main/2", display_name: "x" }] },
    { stream_id: "3", viewer_count: 2, viewers: ["bob", { id: "failover:Main/4" }] },
    { stream_id: "4", viewer_count: 0, viewers: [] },
    { stream_id: "5", viewer_count: 1 },
    { stream_id: "6", viewer_count: 1, viewers: ["carol"], via: "Spare" },
  ];
  assert.deepEqual(withoutLentViewers(summary), [
    { stream_id: "3", viewer_count: 1, viewers: ["bob"] },
    { stream_id: "4", viewer_count: 0, viewers: [] },
    { stream_id: "5", viewer_count: 1 },
    { stream_id: "6", viewer_count: 1, viewers: ["carol"], via: "Spare" },
  ]);
  assert.deepEqual(withoutLentViewers(undefined), []);
});
