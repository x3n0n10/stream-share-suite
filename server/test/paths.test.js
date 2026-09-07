// Reading the data path from SUITE_DATA_DIR, and the pieces of validatePath
// that don't need a whole component to exercise. There is deliberately no
// UI-facing override to test here: it's a pure read of its environment
// variable, nothing more.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, chmodSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getDataPath, validatePath } from "../src/store/paths.js";

let originalDataEnv;
let dirs = [];

beforeEach(() => {
  originalDataEnv = process.env.SUITE_DATA_DIR;
});

afterEach(() => {
  if (originalDataEnv === undefined) delete process.env.SUITE_DATA_DIR;
  else process.env.SUITE_DATA_DIR = originalDataEnv;
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "suite-paths-"));
  dirs.push(dir);
  return dir;
}

test("the data path reads directly from SUITE_DATA_DIR", () => {
  process.env.SUITE_DATA_DIR = "/data";
  assert.equal(getDataPath(), "/data");
});

test("with SUITE_DATA_DIR unset, the data path is empty", () => {
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
