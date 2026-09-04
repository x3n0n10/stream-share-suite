// saveComponentValues()'s history side effect — see store/components.js. A
// real change gets snapshotted before being overwritten, a no-op save is
// skipped, and the trail is capped rather than growing forever.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  saveComponentValues,
  getComponentValues,
  listComponentHistory,
  getComponentHistoryEntry,
} from "../src/store/components.js";
import { freshDatabase } from "./helpers.js";

beforeEach(() => {
  freshDatabase();
});

test("the first save of a component writes no history — there is nothing to snapshot yet", () => {
  saveComponentValues("gluetun", { vpnServiceProvider: "nordvpn" });
  assert.deepEqual(listComponentHistory("gluetun"), []);
});

test("a save that actually changes the values snapshots the previous ones", () => {
  saveComponentValues("gluetun", { vpnServiceProvider: "nordvpn" });
  saveComponentValues("gluetun", { vpnServiceProvider: "mullvad" });

  const history = listComponentHistory("gluetun");
  assert.equal(history.length, 1);

  const entry = getComponentHistoryEntry(history[0].id);
  assert.deepEqual(JSON.parse(entry.config_json), { vpnServiceProvider: "nordvpn" });
});

test("saving identical values again writes no new history entry", () => {
  const values = { vpnServiceProvider: "nordvpn" };
  saveComponentValues("gluetun", values);
  saveComponentValues("gluetun", values);
  saveComponentValues("gluetun", { ...values });

  assert.equal(listComponentHistory("gluetun").length, 0);
});

test("history is capped at the last 10 versions per (kind, key)", () => {
  saveComponentValues("gluetun", { n: 0 });
  for (let n = 1; n <= 12; n++) {
    saveComponentValues("gluetun", { n });
  }

  const history = listComponentHistory("gluetun", "", 100);
  assert.equal(history.length, 10);
});

test("history is scoped per (kind, key) — an instance's history never leaks into another's", () => {
  saveComponentValues("instance", { displayName: "a" }, "provider-1");
  saveComponentValues("instance", { displayName: "a2" }, "provider-1");
  saveComponentValues("instance", { displayName: "b" }, "provider-2");
  saveComponentValues("instance", { displayName: "b2" }, "provider-2");

  assert.equal(listComponentHistory("instance", "provider-1").length, 1);
  assert.equal(listComponentHistory("instance", "provider-2").length, 1);
});

test("restoring a past version is itself a save, so it lands in history too", () => {
  saveComponentValues("gluetun", { vpnServiceProvider: "nordvpn" });
  saveComponentValues("gluetun", { vpnServiceProvider: "mullvad" });

  const [{ id }] = listComponentHistory("gluetun");
  const entry = getComponentHistoryEntry(id);
  saveComponentValues("gluetun", JSON.parse(entry.config_json));

  assert.deepEqual(getComponentValues("gluetun"), { vpnServiceProvider: "nordvpn" });
  assert.equal(listComponentHistory("gluetun").length, 2);
});

test("getComponentHistoryEntry returns null for an id that doesn't exist", () => {
  assert.equal(getComponentHistoryEntry(999999), null);
});
