// Where components keep their data on the host.
//
// Two stack-wide paths rather than a setting per component: a base path whose
// subfolders hold configuration, and a separate cache root, because a VOD or
// catchup cache reaches tens of gigabytes and usually belongs on a different
// disk from a few kilobytes of config.
//
// These are HOST paths, because they become bind-mount sources for containers
// the Suite creates — and a bind mount is resolved by the Docker daemon on the
// host, not inside the Suite. That means the Suite cannot create a directory
// at a host path it cannot itself see. Rather than carrying a second "and
// where is that mounted inside you" setting for every path, the Suite requires
// each path to be mounted at the same location inside its own container:
//
//   volumes:
//     - /mnt/user/appdata/streamshare:/mnt/user/appdata/streamshare
//
// Then the path means the same thing on both sides of the boundary and there
// is nothing to translate. validatePath below is what turns getting this wrong
// into a sentence rather than a container that fails to start.
//
// Both paths come from environment variables — SUITE_DATA_DIR (the same
// folder suite.db already lives in) and SUITE_CACHE_DIR — set once in compose
// and never touched in the UI; see the README's "Where component data lives"
// section. There is deliberately no UI-facing override: the only consumer of
// one would have been re-declaring the exact same string the compose file
// already carries, which is the retyping this was built to avoid, not a
// second real use case.
//
// Self-inspection (the same trick that computes gluetun's
// FIREWALL_OUTBOUND_SUBNETS from the Suite's own networks) was considered and
// rejected for reading these at all: `docker inspect` would hand back every
// one of the Suite's bind mounts, but not which one is "the cache path" —
// that's a question about intent, not topology, and there is no reliable way
// to tell a config mount from a cache mount from an unrelated one an operator
// happens to have without some deliberate signal. An env var already is that
// signal, and declaring it once in compose is exactly as much typing as a
// label would have been.
//
// Reading these correctly depends on the backing variable being a bind mount
// rather than a Docker-managed named volume: the Suite cannot tell the two
// apart by looking at it from inside — both simply appear as a writable
// directory. Someone who keeps a named volume from an earlier phase and
// upgrades without changing it will have this silently resolve to the wrong
// kind of path, so the shipped compose file uses bind mounts for both
// variables for exactly this reason.

import { mkdirSync, chmodSync, statSync, accessSync, constants } from "node:fs";
import path from "node:path";

export function getDataPath() {
  return String(process.env.SUITE_DATA_DIR || "").trim();
}

export function getCachePath() {
  return String(process.env.SUITE_CACHE_DIR || "").trim();
}

// The ids component data is created as. The Suite already runs as these (the
// entrypoint drops to them), so a directory it creates is owned by them; the
// containers it creates are told to run as them too, which is what keeps a
// non-root image able to write its own bind-mounted config.
export function ownership() {
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  return uid === undefined || gid === undefined ? null : { uid, gid };
}

export function ownershipString() {
  const own = ownership();
  return own ? `${own.uid}:${own.gid}` : "";
}

// Checked at save time rather than at apply time, so a mistyped or unmounted
// path is a message on the form instead of a container that will not start.
export function validatePath(candidate, label) {
  const value = String(candidate || "").trim();

  if (!value) return `${label} is required.`;
  if (!path.isAbsolute(value)) return `${label} must be an absolute path, not "${value}".`;

  let stat;
  try {
    stat = statSync(value);
  } catch {
    return (
      `${label} "${value}" is not visible to the Suite. Mount it into this container ` +
      `at the same path — add "- ${value}:${value}" to the Suite's volumes — and make sure it exists on the host.`
    );
  }

  if (!stat.isDirectory()) return `${label} "${value}" exists but is not a directory.`;

  try {
    accessSync(value, constants.W_OK);
  } catch {
    const own = ownership();
    return (
      `${label} "${value}" is not writable by the Suite` +
      (own ? ` (running as uid ${own.uid}:${own.gid})` : "") +
      `. Change its ownership on the host, or set PUID/PGID to ids that can write to it.`
    );
  }

  return null;
}

// Creates a component's directory and hands back the host path to bind-mount.
// Because the path is mounted identically on both sides, the string that
// worked here is the string the daemon will resolve.
//
// Wide open (0o777) rather than owner/group-only, and re-applied on every
// call rather than only at creation — deliberately. This directory is handed
// straight to a container the Suite does not otherwise control: an official
// postgres image starts as root and only drops to its own uid after it can
// write here, and there is no way to know that uid in advance. On a plain
// local filesystem root would not even need the grant, but a FUSE-backed
// share (Unraid's /mnt/user among them) can enforce mode bits against literal
// root too — "can't create directory ... Permission denied" on every restart,
// not just the first, is exactly that. mkdirSync's own `mode` option is only
// applied when it actually creates the directory, so a chmod every time is
// what fixes a directory that already exists from before this changed.
export function ensureDirectory(...segments) {
  const target = path.join(...segments);
  mkdirSync(target, { recursive: true, mode: 0o777 });
  chmodSync(target, 0o777);
  return target;
}

// Where one component's configuration lives: <base>/<name>.
export function componentDataDir(name) {
  const base = getDataPath();
  return base ? path.join(base, name) : "";
}

// Where one instance's cache lives: <cacheRoot>/<name>.
export function componentCacheDir(name) {
  const base = getCachePath();
  return base ? path.join(base, name) : "";
}
