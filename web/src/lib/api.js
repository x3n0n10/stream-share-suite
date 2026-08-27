// All calls go through here so three things stay in one place: the CSRF echo
// on state-changing requests, the 401 handling that hands control back to the
// auth screens, and the cold-load provider refresh.

class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body || {};
  }
}

// The CSRF token is the session token echoed in a header — see requireCsrf on
// the server. It lives in module state rather than storage: it is only useful
// alongside the cookie, and a reload re-reads it from /api/auth/status.
let csrfToken = null;

export function setCsrfToken(token) {
  csrfToken = token || null;
}

// Set by App so any 401 anywhere can bounce the whole UI back to the login
// screen instead of leaving a page half-rendered with stale data.
let onUnauthorized = () => {};

export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn || (() => {});
}

async function request(method, path, { params, body } = {}) {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url.pathname + url.search, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(csrfToken && method !== "GET" ? { "X-Suite-CSRF": csrfToken } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const payload = await res.json().catch(() => ({}));

  // A 401 from the auth endpoints is that form's own business — a wrong
  // password should surface inline, not tear down the shell around it.
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    csrfToken = null;
    onUnauthorized(payload);
  }

  if (!res.ok) {
    throw new ApiError(payload.error || `Request to ${path} failed: HTTP ${res.status}`, res.status, payload);
  }
  return payload;
}

const get = (path, params) => request("GET", path, { params });
const post = (path, body) => request("POST", path, { body });
const put = (path, body) => request("PUT", path, { body });
const del = (path) => request("DELETE", path);

// True until the first /api/overview of this page load comes back. It asks the
// instances to re-read their provider subscription from the provider instead of
// serving their cached copy, so a freshly opened dashboard shows current numbers
// rather than something up to a refresh-interval old.
//
// Module state is exactly the right scope: a browser reload resets it (which is
// what the operator means by "reload the page"), while navigating between
// pages, changing the time window, or the 15s poll does not.
let coldLoad = true;

export const api = {
  authStatus: () => get("/api/auth/status"),
  setup: (username, password) => post("/api/auth/setup", { username, password }),
  login: (username, password) => post("/api/auth/login", { username, password }),
  logout: () => post("/api/auth/logout"),
  changePassword: (currentPassword, newPassword) =>
    post("/api/auth/password", { currentPassword, newPassword }),

  config: () => get("/api/config"),
  overview: async (hours) => {
    // Claim the cold load before awaiting, not after: a mount can issue two
    // overview calls in the same tick (the poll interval arrives with the
    // config and re-runs the effect), and only one of them should force a
    // provider read. A throw hands the claim back, so a first load that never
    // landed still forces on its retry.
    const refresh = coldLoad;
    coldLoad = false;
    try {
      return await get("/api/overview", { hours, refresh: refresh ? 1 : undefined });
    } catch (err) {
      if (refresh) coldLoad = true;
      throw err;
    }
  },
  history: (hours, limit) => get("/api/history", { hours, limit }),
  leaderboard: (hours) => get("/api/leaderboard", { hours }),
  users: () => get("/api/users"),
  streams: () => get("/api/streams"),
  userHistory: (instanceId, username, hours) =>
    get(`/api/instances/${instanceId}/users/${encodeURIComponent(username)}/history`, { hours }),
  gluetunStatus: () => get("/api/gluetun"),
  gluetunStart: () => post("/api/gluetun/start"),
  gluetunStop: () => post("/api/gluetun/stop"),
  gluetunReconnect: () => post("/api/gluetun/reconnect"),
  vodSearch: (q) => get("/api/vod/search", { q }),
  vodDownload: (instanceId, streamId, title, type) =>
    post(`/api/instances/${instanceId}/vod/download`, { streamId, title, type }),
  aliases: () => get("/api/aliases"),
  createAlias: (instanceId, ipAddress, alias) =>
    post(`/api/instances/${instanceId}/aliases`, { ipAddress, alias }),
  deleteAlias: (instanceId, ipAddress) =>
    post(`/api/instances/${instanceId}/aliases/delete`, { ipAddress }),

  settings: () => get("/api/settings"),
  saveSettings: (payload) => put("/api/settings", payload),
  listInstances: () => get("/api/settings/instances"),
  createInstance: (payload) => post("/api/settings/instances", payload),
  updateInstance: (id, payload) => put(`/api/settings/instances/${id}`, payload),
  deleteInstance: (id) => del(`/api/settings/instances/${id}`),
  testInstance: (payload) => post("/api/settings/instances/test", payload),

  dockerStatus: () => get("/api/stack/docker/status"),
  stackComponents: () => get("/api/stack/components"),
  componentFields: (kind) => get(`/api/stack/components/${kind}`),
  saveComponent: (kind, payload) => put(`/api/stack/components/${kind}`, payload),
  componentPlan: (kind) => get(`/api/stack/components/${kind}/plan`),
  applyComponent: (kind, payload) => post(`/api/stack/components/${kind}/apply`, payload),
  job: (jobId) => get(`/api/stack/jobs/${jobId}`),
};

export { ApiError };
