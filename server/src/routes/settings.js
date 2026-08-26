// Instance and settings management — the part that replaces hand-editing
// INSTANCE_N_* in a compose file.
//
// Secrets follow one convention throughout: they are never returned, only
// replaced. A GET reports whether a value is set; a PUT that omits the field
// leaves it alone, sends a string to replace it, or null to clear it. That is
// what lets an edit form round-trip without ever having held the secret.

import { Router } from "express";
import {
  createInstance,
  deleteInstance,
  getInstance,
  listInstances,
  reorderInstances,
  toPublic,
  updateInstance,
} from "../store/instances.js";
import { getNumber, getSetting, setSettings } from "../store/settings.js";
import { pingInstance } from "../instanceClient.js";
import { DEFAULTS } from "../config.js";

// Rejects anything that isn't an absolute http(s) URL, so a typo surfaces at
// save time rather than as a confusing fetch failure on the next poll.
function validateUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "URL is required.";
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    return "URL must be absolute, e.g. http://172.18.0.11:8080";
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return "URL must start with http:// or https://";
  }
  return null;
}

function validateName(value, label = "Name") {
  if (typeof value !== "string" || !value.trim()) return `${label} is required.`;
  if (value.trim().length > 80) return `${label} must be at most 80 characters.`;
  return null;
}

// undefined = leave as-is, "" or null = clear, string = replace.
function secretUpdate(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return String(value);
}

export function createSettingsRouter() {
  const router = Router();

  router.get("/", (req, res) => {
    res.json({
      general: {
        title: getSetting("general.title") || DEFAULTS.title,
        pollIntervalMs: getNumber("general.poll_interval_ms", DEFAULTS.pollIntervalMs),
        instanceTimeoutMs: getNumber("general.instance_timeout_ms", DEFAULTS.requestTimeoutMs),
        vodSearchTimeoutMs: getNumber("general.vod_search_timeout_ms", DEFAULTS.vodSearchTimeoutMs),
        vodActorUsername: getSetting("general.vod_actor_username") || DEFAULTS.vodActorUsername,
      },
      gluetun: {
        url: getSetting("gluetun.url") || "",
        user: getSetting("gluetun.user") || "",
        statusPath: getSetting("gluetun.status_path") || "/v1/vpn/status",
        timeoutMs: getNumber("gluetun.timeout_ms", 5000),
        reconnectTimeoutMs: getNumber("gluetun.reconnect_timeout_ms", 45000),
        // Write-only, per the convention above.
        passwordSet: !!getSetting("gluetun.password"),
        apiKeySet: !!getSetting("gluetun.api_key"),
      },
    });
  });

  router.put("/", (req, res) => {
    const { general = {}, gluetun = {} } = req.body || {};
    const updates = {};

    if (general.title !== undefined) {
      const err = validateName(general.title, "Title");
      if (err) return res.status(400).json({ error: err });
      updates["general.title"] = general.title.trim();
    }
    // Floors match config.js so a value saved here cannot read back different.
    if (general.pollIntervalMs !== undefined) {
      updates["general.poll_interval_ms"] = Math.max(5000, Number(general.pollIntervalMs) || DEFAULTS.pollIntervalMs);
    }
    if (general.instanceTimeoutMs !== undefined) {
      updates["general.instance_timeout_ms"] = Math.max(1000, Number(general.instanceTimeoutMs) || DEFAULTS.requestTimeoutMs);
    }
    if (general.vodSearchTimeoutMs !== undefined) {
      updates["general.vod_search_timeout_ms"] = Math.max(5000, Number(general.vodSearchTimeoutMs) || DEFAULTS.vodSearchTimeoutMs);
    }
    if (general.vodActorUsername !== undefined) {
      updates["general.vod_actor_username"] = String(general.vodActorUsername).trim() || DEFAULTS.vodActorUsername;
    }

    if (gluetun.url !== undefined) {
      const trimmed = String(gluetun.url).trim();
      if (trimmed) {
        const err = validateUrl(trimmed);
        if (err) return res.status(400).json({ error: `Gluetun ${err[0].toLowerCase()}${err.slice(1)}` });
      }
      updates["gluetun.url"] = trimmed.replace(/\/+$/, "");
    }
    if (gluetun.user !== undefined) updates["gluetun.user"] = String(gluetun.user).trim();
    if (gluetun.statusPath !== undefined) {
      updates["gluetun.status_path"] = String(gluetun.statusPath).trim() || "/v1/vpn/status";
    }
    if (gluetun.timeoutMs !== undefined) {
      updates["gluetun.timeout_ms"] = Math.max(1000, Number(gluetun.timeoutMs) || 5000);
    }
    if (gluetun.reconnectTimeoutMs !== undefined) {
      updates["gluetun.reconnect_timeout_ms"] = Math.max(15000, Number(gluetun.reconnectTimeoutMs) || 45000);
    }

    const password = secretUpdate(gluetun.password);
    if (password !== undefined) updates["gluetun.password"] = password;
    const apiKey = secretUpdate(gluetun.apiKey);
    if (apiKey !== undefined) updates["gluetun.api_key"] = apiKey;

    setSettings(updates);
    res.json({ ok: true });
  });

  router.get("/instances", (req, res) => {
    res.json({ instances: listInstances({ includeDisabled: true }).map(toPublic) });
  });

  router.post("/instances", (req, res) => {
    const { name, url, apiKey, enabled } = req.body || {};

    const nameErr = validateName(name);
    if (nameErr) return res.status(400).json({ error: nameErr });
    const urlErr = validateUrl(url);
    if (urlErr) return res.status(400).json({ error: urlErr });

    // Not a hard requirement — stream-share generates a key at startup when
    // unset — but an instance without one gets 401s on every call, so it is
    // worth refusing rather than shipping a permanently red row.
    if (!apiKey || !String(apiKey).trim()) {
      return res.status(400).json({
        error: "An API key is required. Use the instance's INTERNAL_API_KEY.",
      });
    }

    const instance = createInstance({
      name: name.trim(),
      url,
      apiKey: String(apiKey).trim(),
      enabled: enabled !== false,
    });
    res.status(201).json({ instance: toPublic(instance) });
  });

  router.put("/instances/:id", (req, res) => {
    if (!getInstance(req.params.id)) return res.status(404).json({ error: "Unknown instance" });

    const { name, url, apiKey, enabled } = req.body || {};

    if (name !== undefined) {
      const err = validateName(name);
      if (err) return res.status(400).json({ error: err });
    }
    if (url !== undefined) {
      const err = validateUrl(url);
      if (err) return res.status(400).json({ error: err });
    }

    const updated = updateInstance(req.params.id, {
      name: name === undefined ? undefined : name.trim(),
      url,
      apiKey: secretUpdate(apiKey),
      enabled,
    });
    res.json({ instance: toPublic(updated) });
  });

  router.delete("/instances/:id", (req, res) => {
    if (!deleteInstance(req.params.id)) return res.status(404).json({ error: "Unknown instance" });
    res.json({ ok: true });
  });

  router.post("/instances/reorder", (req, res) => {
    const { order } = req.body || {};
    if (!Array.isArray(order)) return res.status(400).json({ error: "order must be an array of ids" });
    reorderInstances(order.map(String));
    res.json({ ok: true });
  });

  // Checks credentials against a live instance before the operator commits to
  // saving them. Accepts an unsaved url/apiKey pair so the form can verify what
  // is on screen rather than what is already stored.
  router.post("/instances/test", async (req, res) => {
    const { url, apiKey, id } = req.body || {};

    let target;
    if (url) {
      const err = validateUrl(url);
      if (err) return res.status(400).json({ error: err });
      const stored = id ? getInstance(id) : null;
      target = {
        url: String(url).trim().replace(/\/+$/, ""),
        // An edit form that left the key untouched has no key to send, so fall
        // back to the stored one — otherwise "Test" would always fail on an
        // instance whose key the operator never re-typed.
        apiKey: apiKey ? String(apiKey).trim() : stored ? stored.apiKey : "",
      };
    } else if (id) {
      target = getInstance(id);
      if (!target) return res.status(404).json({ error: "Unknown instance" });
    } else {
      return res.status(400).json({ error: "url or id is required" });
    }

    try {
      const info = await pingInstance(target, { timeoutMs: 8000 });
      res.json({ ok: true, instance: info });
    } catch (err) {
      res.status(200).json({ ok: false, error: err.message });
    }
  });

  return router;
}
