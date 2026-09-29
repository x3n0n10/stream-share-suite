// The DNS-challenge start script, run for real under sh against a stand-in for
// the caddy binary: which packages it adds, which it leaves alone, that it
// never starts Caddy when adding fails, and that the built binary is cached in
// the config folder so a recreated container does not download again.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CADDY_START_SCRIPT } from "../src/reconcile/caddy.js";

// `list-modules --packages` prints whatever is in $STUB_DIR/packages;
// `add-package` records its arguments in $STUB_DIR/log and installs them
// (unless STUB_FAIL_ADD is set); `run` records that Caddy was started;
// `version` prints $STUB_VERSION.
const STUB = `#!/bin/sh
case "$1" in
  version) echo "\${STUB_VERSION:-v2.8.4}" ;;
  list-modules) cat "$STUB_DIR/packages" ;;
  add-package)
    shift
    echo "add-package $*" >> "$STUB_DIR/log"
    [ -n "$STUB_FAIL_ADD" ] && exit 1
    for p in "$@"; do echo "\${p%@*}" >> "$STUB_DIR/packages"; done
    ;;
  run)
    shift
    echo "run $*" >> "$STUB_DIR/log"
    ;;
esac
`;

const RUN = "run --config /etc/caddy/Caddyfile --adapter caddyfile";

let dir;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "caddy-start-"));
  writeFileSync(path.join(dir, "caddy"), STUB);
  chmodSync(path.join(dir, "caddy"), 0o755);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

// `cacheDir` stands in for /config; reuse it across calls to model a recreated
// container, and vary `version` to model an image upgrade. Returns the
// caddy-dns-* files left in it as `cached`.
function start(modules, { installed = [], failAdd = false, version, cacheDir = path.join(dir, "cache") } = {}) {
  rmSync(path.join(dir, "log"), { force: true }); // one test may start the script twice
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(path.join(dir, "packages"), installed.map((p) => `${p}\n`).join(""));
  const script = CADDY_START_SCRIPT.replace("cache=/config", `cache=${cacheDir}`);
  const result = spawnSync("sh", ["-c", script, "sh", ...modules], {
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      STUB_DIR: dir,
      ...(version ? { STUB_VERSION: version } : {}),
      ...(failAdd ? { STUB_FAIL_ADD: "1" } : {}),
    },
    encoding: "utf8",
  });
  const logPath = path.join(dir, "log");
  return {
    status: result.status,
    stderr: result.stderr,
    cached: readdirSync(cacheDir).filter((f) => f.startsWith("caddy-dns-")),
    log: existsSync(logPath) ? readFileSync(logPath, "utf8").trim().split("\n") : [],
  };
}

test("a module the binary already has is not added, and Caddy starts", () => {
  const result = start(["github.com/caddy-dns/hetzner/v2"], {
    installed: ["dns.providers.hetzner github.com/caddy-dns/hetzner/v2"],
  });
  assert.equal(result.status, 0);
  assert.deepEqual(result.log, [RUN]);
});

test("a missing module is added, then Caddy starts", () => {
  const result = start(["github.com/caddy-dns/hetzner/v2"]);
  assert.equal(result.status, 0);
  assert.deepEqual(result.log, ["add-package github.com/caddy-dns/hetzner/v2", RUN]);
});

test("with several modules, only the missing ones are added, in one call", () => {
  const result = start(["github.com/caddy-dns/cloudflare", "github.com/caddy-dns/porkbun"], {
    installed: ["dns.providers.cloudflare github.com/caddy-dns/cloudflare"],
  });
  assert.deepEqual(result.log, ["add-package github.com/caddy-dns/porkbun", RUN]);
});

test("a version suffix is ignored for the presence check but passed to add-package", () => {
  const present = start(["github.com/caddy-dns/porkbun@v1.2.3"], { installed: ["github.com/caddy-dns/porkbun"] });
  assert.deepEqual(present.log, [RUN]);

  const missing = start(["github.com/caddy-dns/porkbun@v1.2.3"]);
  assert.deepEqual(missing.log, ["add-package github.com/caddy-dns/porkbun@v1.2.3", RUN]);
});

test("the presence check matches whole package paths, not prefixes", () => {
  const result = start(["github.com/caddy-dns/hetzner/v2"], { installed: ["github.com/caddy-dns/hetzner"] });
  assert.deepEqual(result.log, ["add-package github.com/caddy-dns/hetzner/v2", RUN]);
});

test("when add-package fails the script exits non-zero and never starts Caddy", () => {
  const result = start(["github.com/caddy-dns/hetzner/v2"], { failAdd: true });
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.log, ["add-package github.com/caddy-dns/hetzner/v2"]);
  assert.match(result.stderr, /caddy add-package failed/);
});

const HETZNER = "github.com/caddy-dns/hetzner/v2";
const CLOUDFLARE = "github.com/caddy-dns/cloudflare";

test("the first start caches the built binary in the config folder", () => {
  const result = start([HETZNER]);
  assert.equal(result.status, 0);
  assert.equal(result.cached.length, 1);
});

test("a recreated container with the same modules and version reuses the cached build without downloading", () => {
  const cacheDir = path.join(dir, "shared-cache");
  start([HETZNER], { cacheDir });

  const again = start([HETZNER], { cacheDir, failAdd: true });
  assert.equal(again.status, 0);
  assert.deepEqual(again.log, [RUN]);
  assert.equal(again.cached.length, 1);
});

test("a different Caddy version misses the cache, downloads again and drops the old build", () => {
  const cacheDir = path.join(dir, "shared-cache");
  const first = start([HETZNER], { cacheDir, version: "v2.8.4" });

  const upgraded = start([HETZNER], { cacheDir, version: "v2.9.0" });
  assert.deepEqual(upgraded.log, [`add-package ${HETZNER}`, RUN]);
  assert.equal(upgraded.cached.length, 1);
  assert.notDeepEqual(upgraded.cached, first.cached);
});

test("different modules miss the cache, download again and drop the old build", () => {
  const cacheDir = path.join(dir, "shared-cache");
  const first = start([HETZNER], { cacheDir });

  const changed = start([CLOUDFLARE], { cacheDir });
  assert.deepEqual(changed.log, [`add-package ${CLOUDFLARE}`, RUN]);
  assert.equal(changed.cached.length, 1);
  assert.notDeepEqual(changed.cached, first.cached);
});

test("nothing is cached when the binary already has every module", () => {
  const result = start([HETZNER], { installed: [`dns.providers.hetzner ${HETZNER}`] });
  assert.equal(result.status, 0);
  assert.deepEqual(result.cached, []);
});

test("nothing is cached when add-package fails", () => {
  const result = start([HETZNER], { failAdd: true });
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.cached, []);
});
