// The DNS-challenge start script, run for real under sh against a stand-in for
// the caddy binary: which packages it adds, which it leaves alone, and that it
// never starts Caddy when adding fails.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CADDY_START_SCRIPT } from "../src/reconcile/caddy.js";

// `list-modules --packages` prints whatever is in $STUB_DIR/packages;
// `add-package` records its arguments in $STUB_DIR/log and installs them
// (unless STUB_FAIL_ADD is set); `run` records that Caddy was started.
const STUB = `#!/bin/sh
case "$1" in
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

function start(modules, { installed = [], failAdd = false } = {}) {
  rmSync(path.join(dir, "log"), { force: true }); // one test may start the script twice
  writeFileSync(path.join(dir, "packages"), installed.map((p) => `${p}\n`).join(""));
  const result = spawnSync("sh", ["-c", CADDY_START_SCRIPT, "sh", ...modules], {
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      STUB_DIR: dir,
      ...(failAdd ? { STUB_FAIL_ADD: "1" } : {}),
    },
    encoding: "utf8",
  });
  const logPath = path.join(dir, "log");
  return {
    status: result.status,
    stderr: result.stderr,
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
