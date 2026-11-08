// Pure shaping of an instance's share links, plus the public base URL a
// Suite-managed instance exposes to the ops layer. The addresses are built
// here, never taken from the instance, because the instance only knows the
// internal address the Suite reaches it on.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers.js";
import { shareAddresses, shapeShare } from "../src/shareLinks.js";
import { loadConfig } from "../src/config.js";
import { provisionInstance } from "../src/reconcile/provisioning.js";
import { saveComponentValues, getComponentValues } from "../src/store/components.js";
import { VPN_ENABLED_SETTING } from "../src/reconcile/catalog.js";
import { setSetting } from "../src/store/settings.js";

beforeEach(() => {
  freshDatabase();
});

test("shareAddresses builds paths and public urls from the base url", () => {
  assert.deepEqual(shareAddresses("https://tv.example.com/", "tok"), {
    paths: { playlist: "/share/tok.m3u", stream: "/share/tok/live.ts" },
    urls: {
      playlist: "https://tv.example.com/share/tok.m3u",
      stream: "https://tv.example.com/share/tok/live.ts",
    },
  });
});

test("shareAddresses returns paths only when the public base url is unknown", () => {
  for (const unknown of ["", undefined]) {
    const a = shareAddresses(unknown, "tok");
    assert.equal(a.urls, null);
    assert.deepEqual(a.paths, { playlist: "/share/tok.m3u", stream: "/share/tok/live.ts" });
  }
});

test("shapeShare camel-cases the instance fields and defaults the optional ones", () => {
  const raw = {
    token: "tok",
    stream_id: "42",
    title: "Eurosport 1",
    created_by: "discord-user",
    starts_at: "2026-10-31T20:00:00Z",
    ends_at: "2026-10-31T23:00:00Z",
    created_at: "2026-10-30T09:00:00Z",
    state: "scheduled",
    urls: { playlist: "http://internal:8080/share/tok.m3u" },
  };
  const share = shapeShare(raw, "");
  assert.equal(share.token, "tok");
  assert.equal(share.streamId, "42");
  assert.equal(share.title, "Eurosport 1");
  assert.equal(share.createdBy, "discord-user");
  assert.equal(share.startsAt, "2026-10-31T20:00:00Z");
  assert.equal(share.endsAt, "2026-10-31T23:00:00Z");
  assert.equal(share.createdAt, "2026-10-30T09:00:00Z");
  assert.equal(share.state, "scheduled");
  assert.equal(share.guest, "");
  assert.equal(share.revokedAt, null);
  assert.equal(share.urls, null, "the instance's internal urls must never be passed on");
  assert.deepEqual(share.paths, { playlist: "/share/tok.m3u", stream: "/share/tok/live.ts" });
});

test("a managed instance exposes its public base url, trimmed", () => {
  setSetting(VPN_ENABLED_SETTING, "false");
  const { key } = provisionInstance({ displayName: "Managed" });
  saveComponentValues(
    "instance",
    { ...getComponentValues("instance", key), publicBaseUrl: "https://tv.example.com//" },
    key
  );

  const managed = loadConfig().instances.find((i) => i.id === key);
  assert.equal(managed.publicBaseUrl, "https://tv.example.com");
});
