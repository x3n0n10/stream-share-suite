import { test } from "node:test";
import assert from "node:assert/strict";
import { connectionUsage } from "../src/lib/connections.js";

test("live count wins over a stale provider total", () => {
  assert.deepEqual(connectionUsage({ active_connections: 0, local_upstream_connections: 2, max_connections: 1 }), { used: 2, here: 2, max: 1 });
});

test("provider total wins when other devices use the account", () => {
  assert.deepEqual(connectionUsage({ active_connections: 3, local_upstream_connections: 1, max_connections: 4 }), { used: 3, here: 1, max: 4 });
});

test("older instances without a live count, and no limit", () => {
  assert.deepEqual(connectionUsage({ active_connections: 1 }), { used: 1, here: null, max: undefined });
  assert.deepEqual(connectionUsage({}), { used: 0, here: null, max: undefined });
});
