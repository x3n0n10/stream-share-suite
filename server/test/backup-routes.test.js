// /api/backup end to end, against a real file-backed store (not the
// in-memory test seam every other suite uses) — a restore closes, swaps, and
// reopens the actual file on disk, so this is the one place that has to be
// real to mean anything.

import { test, before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";
import { openDatabase, closeDatabase, getDatabasePath } from "../src/store/db.js";
import { saveComponentValues, getComponentValues } from "../src/store/components.js";
import { _resetLoginThrottle } from "../src/auth/middleware.js";
import { signedInClient } from "./helpers.js";

let appServer;
let base;
let dir;

before(async () => {
  appServer = createApp({ serveStatic: false }).listen(0);
  await new Promise((resolve) => appServer.once("listening", resolve));
  base = `http://127.0.0.1:${appServer.address().port}`;
});

after(() => appServer.close());

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "suite-backup-test-"));
  openDatabase(dir);
  _resetLoginThrottle();
});

afterEach(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});

test("a downloaded backup is a well-formed SQLite file", async () => {
  const c = await signedInClient(base);
  const res = await c.getBuffer("/api/backup");

  assert.equal(res.status, 200);
  assert.equal(res.buffer.toString("latin1", 0, 15), "SQLite format 3");
});

test("restoring a downloaded backup round-trips: change something, restore, it's back", async () => {
  const c = await signedInClient(base);
  saveComponentValues("gluetun", { vpnServiceProvider: "nordvpn" });

  const backup = await c.getBuffer("/api/backup");
  assert.equal(backup.status, 200);

  saveComponentValues("gluetun", { vpnServiceProvider: "mullvad" });
  assert.equal(getComponentValues("gluetun").vpnServiceProvider, "mullvad");

  const restore = await c.postBuffer("/api/backup/restore", backup.buffer, "application/octet-stream");
  assert.equal(restore.status, 200);
  assert.equal(getComponentValues("gluetun").vpnServiceProvider, "nordvpn");
});

test("restoring re-opens the database at the same path it was already using", async () => {
  const c = await signedInClient(base);
  const before = getDatabasePath();

  const backup = await c.getBuffer("/api/backup");
  await c.postBuffer("/api/backup/restore", backup.buffer, "application/octet-stream");

  assert.equal(getDatabasePath(), before);
});

test("restoring a bogus (non-SQLite) upload is rejected and leaves the existing store untouched", async () => {
  const c = await signedInClient(base);
  saveComponentValues("gluetun", { vpnServiceProvider: "nordvpn" });

  const res = await c.postBuffer("/api/backup/restore", Buffer.from("not a database"), "application/octet-stream");
  assert.equal(res.status, 400);
  assert.equal(getComponentValues("gluetun").vpnServiceProvider, "nordvpn");
});

test("restoring an empty upload is rejected", async () => {
  const c = await signedInClient(base);
  const res = await c.postBuffer("/api/backup/restore", Buffer.alloc(0), "application/octet-stream");
  assert.equal(res.status, 400);
});

test("restoring a corrupted file that merely starts with the right header restores the previous database rather than leaving the store unopenable", async () => {
  const c = await signedInClient(base);
  saveComponentValues("gluetun", { vpnServiceProvider: "nordvpn" });

  // Passes the 16-byte header check (the cheap, cheap-to-spoof front gate)
  // but is not a real SQLite file beyond that — opening it for real is what
  // has to fail and trigger the rollback to the safety copy.
  const corrupted = Buffer.concat([Buffer.from("SQLite format 3\0"), Buffer.from("not actually a database".repeat(50))]);

  const res = await c.postBuffer("/api/backup/restore", corrupted, "application/octet-stream");
  assert.equal(res.status, 400);

  // The Suite must still be usable afterwards, with what was there before.
  assert.equal(getComponentValues("gluetun").vpnServiceProvider, "nordvpn");
  assert.ok(existsSync(getDatabasePath()));
});

test("backup endpoints require authentication, same as everything else behind the gate", async () => {
  const res = await fetch(`${base}/api/backup`);
  assert.equal(res.status, 401);
});
