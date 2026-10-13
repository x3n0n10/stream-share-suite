// Minimal GitHub client for the update check. `fetch` is injectable so tests
// never touch the network. Every failure (network, timeout, 403, 429, 5xx)
// throws; only a 404 is a meaningful answer.

const API = "https://api.github.com";
const TIMEOUT_MS = 10_000;

export function createUpstream({ fetch = globalThis.fetch, userAgent = "stream-share-suite" } = {}) {
  async function get(pathname) {
    const res = await fetch(`${API}${pathname}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": userAgent,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${pathname}`);
    return res.json();
  }

  // One head lookup per repo per client, however many commit rows ask.
  const heads = new Map();
  function head(repo, branch) {
    const key = `${repo}@${branch}`;
    if (!heads.has(key)) {
      const p = get(`/repos/${repo}/commits/${branch}`).then((body) => {
        if (!body?.sha) throw new Error(`No head commit for ${key}`);
        return body.sha.slice(0, 7);
      });
      heads.set(key, p);
    }
    return heads.get(key);
  }

  return {
    // Tag name of the latest published release, or null when there is none.
    async latestRelease(repo) {
      const body = await get(`/repos/${repo}/releases/latest`);
      return body?.tag_name || null;
    },

    // null when GitHub does not know the commit (e.g. a local dirty build).
    async commitsAhead(repo, sha, branch) {
      const body = await get(`/repos/${repo}/compare/${sha}...${branch}`);
      if (!body) return null;
      return { ahead: body.ahead_by > 0, head: await head(repo, branch) };
    },
  };
}
