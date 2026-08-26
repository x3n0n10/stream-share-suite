// Operational read/write endpoints across every configured instance.
//
// Carried over from stream-share-dashboard with one structural change: config
// is no longer captured when the router is built, it arrives on the request
// (see withConfig in index.js). That is what lets an instance added in the UI
// show up on the very next poll instead of at the next container restart.

import { Router } from "express";
import {
  fetchInstanceSnapshot,
  fetchHistory,
  fetchStats,
  fetchUsers,
  fetchStreams,
  fetchUserHistory,
  fetchIPAliases,
  upsertIPAlias,
  deleteIPAlias,
  searchVOD,
  createVODDownload,
} from "../instanceClient.js";
import { getVpnStatus, setVpnStatus, getPublicIP, reconnectVpn } from "../gluetunClient.js";

function findInstance(config, id) {
  return config.instances.find((i) => i.id === id);
}

function hoursParam(req, fallback = 24) {
  const raw = Number(req.query.hours);
  return Number.isFinite(raw) ? raw : fallback;
}

// The usual spellings of a boolean query parameter.
function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function timeouts(req) {
  return { timeoutMs: req.config.requestTimeoutMs };
}

// Collects per-instance failures without letting one bad instance empty the
// whole response.
function collect(config, results, onValue) {
  const errors = [];
  config.instances.forEach((instance, idx) => {
    const r = results[idx];
    if (r.status === "fulfilled") onValue(instance, r.value);
    else errors.push({ instanceId: instance.id, instanceName: instance.name, error: r.reason.message });
  });
  return errors;
}

function failure(res, err) {
  res.status(err.status && err.status < 500 ? err.status : 502).json({ error: err.message });
}

export function createOpsRouter() {
  const router = Router();

  // One combined snapshot per instance: identity + live status + windowed stats.
  //
  // ?refresh=1 additionally asks each instance to re-read its subscription from
  // the IPTV provider instead of serving its cached copy. The frontend sends it
  // on the first overview call of a page load only (see api.js); instances
  // rate-limit real provider reads either way, so a reload-happy operator still
  // cannot turn this into provider traffic.
  router.get("/overview", async (req, res) => {
    const hours = hoursParam(req, 24);
    const refreshProvider = isTruthy(req.query.refresh);
    const snapshots = await Promise.all(
      req.config.instances.map((instance) =>
        fetchInstanceSnapshot(instance, { ...timeouts(req), hours, refreshProvider })
      )
    );
    res.json({ hours, instances: snapshots });
  });

  // Chronological watch history merged across every instance, newest first.
  router.get("/history", async (req, res) => {
    const hours = hoursParam(req, 24);
    const limit = Math.min(Number(req.query.limit) || 100, 500);

    const results = await Promise.allSettled(
      req.config.instances.map((instance) =>
        fetchHistory(instance, { ...timeouts(req), hours, limit })
      )
    );

    const merged = [];
    const errors = collect(req.config, results, (instance, value) => {
      for (const item of value.feed || []) {
        merged.push({ ...item, instance_id: instance.id, instance_name: instance.name });
      }
    });

    merged.sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
    res.json({ hours, feed: merged.slice(0, limit), errors });
  });

  // Top titles / top users, summed across instances for the requested window.
  router.get("/leaderboard", async (req, res) => {
    const hours = hoursParam(req, 24);
    const results = await Promise.allSettled(
      req.config.instances.map((instance) => fetchStats(instance, { ...timeouts(req), hours }))
    );

    const titles = new Map();
    const users = new Map();

    const errors = collect(req.config, results, (instance, data) => {
      for (const t of data.top_titles || []) {
        const key = `${t.stream_type}::${t.stream_title}`;
        const existing = titles.get(key) || {
          stream_title: t.stream_title,
          stream_type: t.stream_type,
          views: 0,
          watch_seconds: 0,
          instances: new Set(),
        };
        existing.views += t.views;
        existing.watch_seconds += t.watch_seconds;
        existing.instances.add(instance.name);
        titles.set(key, existing);
      }

      for (const u of data.top_users || []) {
        const existing = users.get(u.username) || {
          username: u.username,
          sessions: 0,
          watch_seconds: 0,
          instances: new Set(),
        };
        existing.sessions += u.sessions;
        existing.watch_seconds += u.watch_seconds;
        existing.instances.add(instance.name);
        users.set(u.username, existing);
      }
    });

    const toSorted = (map, key) =>
      Array.from(map.values())
        .map((v) => ({ ...v, instances: Array.from(v.instances) }))
        .sort((a, b) => b[key] - a[key])
        .slice(0, 10);

    res.json({
      hours,
      top_titles: toSorted(titles, "watch_seconds"),
      top_users: toSorted(users, "watch_seconds"),
      errors,
    });
  });

  // Currently active user sessions across every instance.
  router.get("/users", async (req, res) => {
    const results = await Promise.allSettled(
      req.config.instances.map((instance) => fetchUsers(instance, timeouts(req)))
    );

    const merged = [];
    const errors = collect(req.config, results, (instance, value) => {
      for (const session of value || []) {
        merged.push({ ...session, instance_id: instance.id, instance_name: instance.name });
      }
    });

    res.json({ users: merged, errors });
  });

  // Currently active streams across every instance.
  router.get("/streams", async (req, res) => {
    const results = await Promise.allSettled(
      req.config.instances.map((instance) => fetchStreams(instance, timeouts(req)))
    );

    const merged = [];
    const errors = collect(req.config, results, (instance, value) => {
      for (const stream of value || []) {
        merged.push({ ...stream, instance_id: instance.id, instance_name: instance.name });
      }
    });

    res.json({ streams: merged, errors });
  });

  // Drill-down: one user's history on one specific instance.
  router.get("/instances/:id/users/:username/history", async (req, res) => {
    const instance = findInstance(req.config, req.params.id);
    if (!instance) return res.status(404).json({ error: "Unknown instance" });

    const hours = hoursParam(req, 24 * 7);
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const offset = Number(req.query.offset) || 0;

    try {
      const data = await fetchUserHistory(instance, req.params.username, {
        ...timeouts(req),
        hours,
        limit,
        offset,
      });
      res.json(data);
    } catch (err) {
      failure(res, err);
    }
  });

  // Gluetun VPN status + exit IP. { enabled: false } when no gluetun URL is set.
  router.get("/gluetun", async (req, res) => {
    if (!req.config.gluetun) return res.json({ enabled: false });

    const [vpn, ip] = await Promise.allSettled([
      getVpnStatus(req.config.gluetun),
      getPublicIP(req.config.gluetun),
    ]);

    res.json({
      enabled: true,
      // vpn.status is gluetun's raw response, typically {"status": "running"|"stopped"}
      vpn: vpn.status === "fulfilled" ? vpn.value : null,
      vpnError: vpn.status === "rejected" ? vpn.reason.message : null,
      publicIp: ip.status === "fulfilled" ? ip.value : null,
      publicIpError: ip.status === "rejected" ? ip.reason.message : null,
    });
  });

  // Starts/stops the VPN connection via gluetun's control server.
  router.post("/gluetun/:action(start|stop)", async (req, res) => {
    if (!req.config.gluetun) {
      return res.status(404).json({ error: "Gluetun is not configured (set it under Settings)" });
    }

    const desired = req.params.action === "start" ? "running" : "stopped";
    try {
      res.json(await setVpnStatus(req.config.gluetun, desired));
    } catch (err) {
      failure(res, err);
    }
  });

  // Stop, wait, start, wait — the manual reconnect routine done in one call.
  // Doesn't touch the public IP endpoint itself (see reconnectVpn); the
  // frontend polls /gluetun separately at a faster interval, which is where
  // the exit IP naturally shows up once it's ready.
  router.post("/gluetun/reconnect", async (req, res) => {
    if (!req.config.gluetun) {
      return res.status(404).json({ error: "Gluetun is not configured (set it under Settings)" });
    }

    try {
      const { vpn } = await reconnectVpn(req.config.gluetun);
      res.json({ enabled: true, vpn, vpnError: null });
    } catch (err) {
      failure(res, err);
    }
  });

  // VOD search across every instance. No file sizes probed here (only whatever
  // an instance already had cached) — but the search itself still hits the
  // instance's upstream Xtream provider live, which can take well longer than
  // the normal instance timeout, hence the separate budget.
  router.get("/vod/search", async (req, res) => {
    const query = (req.query.q || "").toString().trim();
    if (!query) return res.json({ query: "", results: [], errors: [] });

    const results = await Promise.allSettled(
      req.config.instances.map((instance) =>
        searchVOD(instance, query, {
          timeoutMs: req.config.vodSearchTimeoutMs,
          username: req.config.vodActorUsername,
        })
      )
    );

    const merged = [];
    const errors = collect(req.config, results, (instance, value) => {
      for (const item of value.results || []) {
        merged.push({ ...item, instance_id: instance.id, instance_name: instance.name });
      }
    });

    merged.sort((a, b) => (a.Title || "").localeCompare(b.Title || ""));
    res.json({ query, results: merged, errors });
  });

  // Creates a temporary download link on the owning instance. The returned
  // download_url points directly at that instance (using its own configured
  // public address) — the browser opens it directly, not through this backend.
  router.post("/instances/:id/vod/download", async (req, res) => {
    const instance = findInstance(req.config, req.params.id);
    if (!instance) return res.status(404).json({ error: "Unknown instance" });

    const { streamId, title, type } = req.body;
    if (!streamId) return res.status(400).json({ error: "streamId is required" });

    try {
      const data = await createVODDownload(
        instance,
        { username: req.config.vodActorUsername, streamId, title, type },
        timeouts(req)
      );
      res.json(data);
    } catch (err) {
      failure(res, err);
    }
  });

  // Every configured IP -> alias, across every instance. Aliases are
  // per-instance (each instance has its own DB), so each row is tagged with
  // which instance it belongs to rather than being deduplicated globally.
  router.get("/aliases", async (req, res) => {
    const results = await Promise.allSettled(
      req.config.instances.map((instance) => fetchIPAliases(instance, timeouts(req)))
    );

    const merged = [];
    const errors = collect(req.config, results, (instance, value) => {
      for (const a of value || []) {
        merged.push({ ...a, instance_id: instance.id, instance_name: instance.name });
      }
    });

    merged.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    res.json({ aliases: merged, errors });
  });

  // Creates the alias for an IP on one instance, or replaces its existing one.
  router.post("/instances/:id/aliases", async (req, res) => {
    const instance = findInstance(req.config, req.params.id);
    if (!instance) return res.status(404).json({ error: "Unknown instance" });

    const { ipAddress, alias } = req.body;
    if (!ipAddress || !alias) {
      return res.status(400).json({ error: "ipAddress and alias are required" });
    }

    try {
      res.json(await upsertIPAlias(instance, { ipAddress, alias }, timeouts(req)));
    } catch (err) {
      failure(res, err);
    }
  });

  // Removes the alias for an IP on one instance, if it has one.
  router.post("/instances/:id/aliases/delete", async (req, res) => {
    const instance = findInstance(req.config, req.params.id);
    if (!instance) return res.status(404).json({ error: "Unknown instance" });

    const { ipAddress } = req.body;
    if (!ipAddress) return res.status(400).json({ error: "ipAddress is required" });

    try {
      await deleteIPAlias(instance, ipAddress, timeouts(req));
      res.json({ success: true });
    } catch (err) {
      failure(res, err);
    }
  });

  return router;
}
