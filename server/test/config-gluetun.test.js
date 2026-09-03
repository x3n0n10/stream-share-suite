// readGluetun()'s fallback to the reconciler's own gluetun component — see
// config.js. An operator who lets the Stack page create gluetun should never
// have to type its address in a second time here, but a totally unconfigured
// fresh install must still report no VPN page at all.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { setSetting } from "../src/store/settings.js";
import { saveComponentValues } from "../src/store/components.js";
import { VPN_ENABLED_SETTING } from "../src/reconcile/catalog.js";
import { freshDatabase } from "./helpers.js";

beforeEach(() => {
  freshDatabase();
});

test("a fresh install with nothing configured reports no gluetun at all", () => {
  // isVpnEnabled() defaults to true, but that alone must never be read as
  // "gluetun is reachable" — nothing has actually been configured yet.
  assert.equal(loadConfig().gluetun, null);
});

test("falls back to the reconciler's gluetun once it has real stored values", () => {
  saveComponentValues("gluetun", {
    vpnServiceProvider: "nordvpn",
    vpnType: "wireguard",
    wireguardPrivateKey: "k",
  });

  const config = loadConfig();
  assert.equal(config.gluetun.url, "http://streamshare-suite-gluetun:8000");
  assert.equal(config.gluetun.apiKey, "");
  assert.equal(config.gluetun.basicAuth, null);
});

test("an explicit containerName override is reflected in the fallback URL", () => {
  saveComponentValues("gluetun", {
    vpnServiceProvider: "nordvpn",
    vpnType: "wireguard",
    wireguardPrivateKey: "k",
    containerName: "my-own-gluetun",
  });

  assert.equal(loadConfig().gluetun.url, "http://my-own-gluetun:8000");
});

test("an explicit gluetun.url setting always wins over the fallback", () => {
  saveComponentValues("gluetun", { vpnServiceProvider: "nordvpn" });
  setSetting("gluetun.url", "http://my-adopted-gluetun:9000");

  assert.equal(loadConfig().gluetun.url, "http://my-adopted-gluetun:9000");
});

test("no fallback while the VPN is switched off, even with gluetun configured", () => {
  saveComponentValues("gluetun", { vpnServiceProvider: "nordvpn" });
  setSetting(VPN_ENABLED_SETTING, "false");

  assert.equal(loadConfig().gluetun, null);
});
