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
// The data path defaults to SUITE_DATA_DIR — the same folder suite.db already
// lives in — so a stack laid out that way needs no separate setting at all;
// see the README's "Where component data lives" section. That default is only
// correct if SUITE_DATA_DIR is itself a bind mount, though: the Suite cannot
// tell a bind mount apart from a Docker-managed named volume by looking at it
// from inside — both simply appear as a writable directory. Someone who keeps
// the named-volume default from earlier phases and upgrades without changing
// it will have this default silently resolve to the wrong kind of path, so
// the shipped compose file switches to a bind mount for exactly this reason.

import { mkdirSync, statSync, accessSync, constants } from "node:fs";
import path from "node:path";
import { getSetting, setSetting } from "./settings.js";

export const DATA_PATH_SETTING = "stack.data_path";
export const CACHE_PATH_SETTING = "stack.cache_path";

export function getDataPath() {
  return getSetting(DATA_PATH_SETTING) || String(process.env.SUITE_DATA_DIR || "").trim();
}

export function getCachePath() {
  return getSetting(CACHE_PATH_SETTING) || "";
}

export function setPaths({ dataPath, cachePath }) {
  if (dataPath !== undefined) setSetting(DATA_PATH_SETTING, dataPath);
  if (cachePath !== undefined) setSetting(CACHE_PATH_SETTING, cachePath);
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
export function ensureDirectory(...segments) {
  const target = path.join(...segments);
  mkdirSync(target, { recursive: true, mode: 0o770 });
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
