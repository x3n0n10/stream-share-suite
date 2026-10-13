// Decides which version rows are worth asking GitHub about, stores what is
// newer, and joins that result onto the versions response. Nothing here
// pulls or changes anything.

import { getBoolean, getSetting, setSetting } from "../store/settings.js";
import { isNewerRelease, parseVersion } from "./compare.js";

export const AUTO_CHECK_SETTING = "general.auto_update_check";
const RESULT_SETTING = "update_check_result";

// Caddy has no default branch: it is only checked when pinned to a release tag.
const REPOS = {
  suite: { repo: "x3n0n10/stream-share-suite", branch: "main" },
  instance: { repo: "x3n0n10/stream-share", branch: "master" },
  gluetun: { repo: "qdm12/gluetun", branch: "master" },
  caddy: { repo: "caddyserver/caddy", branch: null },
};

export const settingsStore = {
  get() {
    try {
      return JSON.parse(getSetting(RESULT_SETTING) || "null");
    } catch {
      return null;
    }
  },
  set(result) {
    setSetting(RESULT_SETTING, JSON.stringify(result));
  },
};

export function isAutoCheckEnabled() {
  return getBoolean(AUTO_CHECK_SETTING, true);
}

// When the last check ran, and the last attempt (they differ after a failed run).
export function updateCheckStatus(store = settingsStore) {
  const r = store.get() || {};
  return { checkedAt: r.checkedAt ?? null, attemptedAt: r.attemptedAt ?? null };
}

// The repo entry and parsed version to check for a row, or null.
function target(kind, { status, version, source }) {
  const entry = REPOS[kind];
  if (!entry || status !== "running" || !version || source === "image-id") return null;
  const parsed = parseVersion(version);
  if (!parsed) return null;
  if (kind === "caddy" && !(source === "tag" && parsed.type === "release")) return null;
  return { ...entry, parsed };
}

const rowKey = (row) => `${row.kind}:${row.key}`;

// Asks upstream about every eligible row and stores what is newer. Never
// throws: a failing row keeps its previous stored value and the run is not
// counted as complete (`checkedAt` stays), so it is retried sooner.
export async function runUpdateCheck({ versions, upstream, store = settingsStore, now = () => new Date() }) {
  const prev = store.get() || {};
  const prevRows = prev.rows || {};
  const releases = new Map();
  let failed = false;

  async function latestFor(kind, current) {
    const t = target(kind, current);
    if (!t) return undefined; // not checked: keep nothing
    try {
      if (t.parsed.type === "release") {
        if (!releases.has(t.repo)) releases.set(t.repo, upstream.latestRelease(t.repo));
        const tag = await releases.get(t.repo);
        if (!tag || !isNewerRelease(current.version, tag)) return null;
        const bare = tag.replace(/^v/, "");
        return t.parsed.hasV ? `v${bare}` : bare;
      }
      const r = await upstream.commitsAhead(t.repo, t.parsed.sha, t.branch);
      return r?.ahead ? r.head : null;
    } catch (err) {
      failed = true;
      console.warn(`[updates] ${kind}: ${err.message}`);
      return "failed";
    }
  }

  const rows = {};
  const settle = async (kind, key, current, previous) => {
    const latest = await latestFor(kind, current);
    if (latest === "failed") return previous;
    return latest ?? undefined;
  };

  const suite = await settle("suite", "", { ...versions.suite, status: "running" }, prev.suite);
  for (const row of versions.components) {
    const latest = await settle(row.kind, row.key, row, prevRows[rowKey(row)]);
    if (latest) rows[rowKey(row)] = latest;
  }

  const at = now().toISOString();
  const result = { checkedAt: failed ? prev.checkedAt : at, attemptedAt: at, rows };
  if (suite) result.suite = suite;
  if (!result.checkedAt) delete result.checkedAt;
  store.set(result);
  return result;
}

// Adds `latest` to the suite and every row. Reads only the stored result, and
// shows a hint only while it is still newer than what is running now.
export function withUpdates(versions, { store = settingsStore, enabled = isAutoCheckEnabled } = {}) {
  const stored = enabled() ? store.get() : null;
  const pick = (current, latest) => {
    if (!latest) return null;
    const a = parseVersion(current);
    const b = parseVersion(latest);
    if (a?.type === "release") return isNewerRelease(current, latest) ? latest : null;
    // Commit hints cannot be re-compared locally; drop them once the running
    // commit is the hinted one.
    return a?.type === "commit" && b?.type === "commit" && a.sha.startsWith(b.sha) ? null : latest;
  };
  return {
    ...versions,
    suite: { ...versions.suite, latest: pick(versions.suite.version, stored?.suite) },
    components: versions.components.map((row) => ({
      ...row,
      latest: pick(row.version, stored?.rows?.[rowKey(row)]),
    })),
  };
}
