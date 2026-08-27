// The data path's default resolution from SUITE_DATA_DIR, and the pieces of
// validatePath that don't need a whole component to exercise.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, chmodSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getDataPath, getCachePath, setPaths, validatePath } from "../src/store/paths.js";
import { freshDatabase } from "./helpers.js";

let originalEnv;
let dirs = [];

beforeEach(() => {
  freshDatabase();
  originalEnv = process.env.SUITE_DATA_DIR;
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.SUITE_DATA_DIR;
  else process.env.SUITE_DATA_DIR = originalEnv;
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "suite-paths-"));
  dirs.push(dir);
  return dir;
}

test("with nothing stored, the data path falls back to SUITE_DATA_DIR", () => {
  process.env.SUITE_DATA_DIR = "/data";
  assert.equal(getDataPath(), "/data");
});

test("an explicitly saved path overrides SUITE_DATA_DIR", () => {
  process.env.SUITE_DATA_DIR = "/data";
  setPaths({ dataPath: "/mnt/user/appdata/streamshare" });
  assert.equal(getDataPath(), "/mnt/user/appdata/streamshare");
});

test("with SUITE_DATA_DIR unset and nothing saved, the data path is empty", () => {
  delete process.env.SUITE_DATA_DIR;
  assert.equal(getDataPath(), "");
});

test("a blank SUITE_DATA_DIR is treated the same as unset", () => {
  process.env.SUITE_DATA_DIR = "   ";
  assert.equal(getDataPath(), "");
});

test("validatePath accepts a real, writable directory", () => {
  assert.equal(validatePath(tempDir(), "The stack data path"), null);
});

test("validatePath rejects a relative path", () => {
  const message = validatePath("relative/path", "The stack data path");
  assert.match(message, /must be an absolute path/);
});

test("validatePath rejects a path that does not exist, naming the fix", () => {
  const message = validatePath("/definitely/not/mounted/anywhere", "The stack data path");
  assert.match(message, /not visible to the Suite/);
  assert.match(message, /Mount it into this container/);
});

test("validatePath rejects a file, distinctly from a missing path", () => {
  const dir = tempDir();
  const file = path.join(dir, "not-a-directory");
  writeFileSync(file, "");
  assert.match(validatePath(file, "The stack data path"), /is not a directory/);
});

test("validatePath rejects a directory it cannot write to", { skip: process.getuid?.() === 0 }, () => {
  // root bypasses the permission bits this test relies on, so it can only
  // mean something when run as an unprivileged user — which is how it runs
  // in CI, even though a local dev shell running as root has to skip it.
  const dir = tempDir();
  chmodSync(dir, 0o500);
  try {
    assert.match(validatePath(dir, "The stack data path"), /is not writable/);
  } finally {
    chmodSync(dir, 0o700); // restore so afterEach can remove it
  }
});

test("validatePath requires a value", () => {
  assert.match(validatePath("", "The stack data path"), /is required/);
  assert.match(validatePath(undefined, "The stack data path"), /is required/);
});

// --- the cache path's default, mirroring the data path's ------------------

let originalCacheEnv;

test("with nothing stored, the cache path falls back to SUITE_CACHE_DIR", () => {
  originalCacheEnv = process.env.SUITE_CACHE_DIR;
  process.env.SUITE_CACHE_DIR = "/cache";
  try {
    assert.equal(getCachePath(), "/cache");
  } finally {
    if (originalCacheEnv === undefined) delete process.env.SUITE_CACHE_DIR;
    else process.env.SUITE_CACHE_DIR = originalCacheEnv;
  }
});

test("an explicitly saved cache path overrides SUITE_CACHE_DIR", () => {
  process.env.SUITE_CACHE_DIR = "/cache";
  try {
    setPaths({ cachePath: "/mnt/user/cache/streamshare" });
    assert.equal(getCachePath(), "/mnt/user/cache/streamshare");
  } finally {
    delete process.env.SUITE_CACHE_DIR;
  }
});

test("with SUITE_CACHE_DIR unset and nothing saved, the cache path is empty", () => {
  delete process.env.SUITE_CACHE_DIR;
  assert.equal(getCachePath(), "");
});

test("the data and cache paths default independently of each other", () => {
  process.env.SUITE_DATA_DIR = "/data";
  process.env.SUITE_CACHE_DIR = "/cache";
  try {
    assert.equal(getDataPath(), "/data");
    assert.equal(getCachePath(), "/cache");
  } finally {
    delete process.env.SUITE_DATA_DIR;
    delete process.env.SUITE_CACHE_DIR;
  }
});
