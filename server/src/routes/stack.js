// The reconciler's HTTP surface: configure components, see what applying
// would do across the whole stack, and apply it as a background job with a
// pollable log.
//
// Two levels, deliberately. The stack-level plan is the one that can be
// trusted with a change that touches several containers, because only it
// knows the order and the cascade. The per-component routes stay for a
// one-off tweak to a single thing.

import { Router } from "express";
import { validate, toPublicFields, applyPatch } from "../schema/registry.js";
import {
  getComponentValues,
  saveComponentValues,
  componentId,
  listComponents,
} from "../store/components.js";
import { setSetting } from "../store/settings.js";
import {
  getDataPath,
  getCachePath,
  setPaths,
  validatePath,
  ownershipString,
} from "../store/paths.js";
import {
  getCatalogEntry,
  catalogKinds,
  activeComponents,
  isVpnEnabled,
  VPN_ENABLED_SETTING,
} from "../reconcile/catalog.js";
import { planComponent, planStack, applyPlan, applyStack, removeOrphan } from "../reconcile/reconciler.js";
import { createJob, appendLog, finishJob, getJob } from "../reconcile/jobs.js";
import { ping, DockerError } from "../docker/client.js";
import { instanceUrl, instanceContainerName, PORT_BAND } from "../reconcile/instance.js";
import { provisionInstance, deprovisionInstance } from "../reconcile/provisioning.js";
import { connectionTarget } from "../reconcile/postgres.js";
import { testConnection } from "../reconcile/database.js";

function componentOr404(req, res, next) {
  const entry = getCatalogEntry(req.params.kind);
  if (!entry) return res.status(404).json({ error: `Unknown component kind: ${req.params.kind}` });
  req.componentEntry = entry;
  req.componentKey = req.query.key || "";
  next();
}

// Resolves a configured component to the live node the reconciler plans
// against. A kind that is switched off (gluetun with the VPN disabled) is
// configurable but not plannable — planning something that is not part of the
// stack would produce a row nobody asked for.
function activeNode(kind, key = "") {
  return activeComponents().find((node) => node.id === componentId(kind, key)) || null;
}

// A plan's spec carries rendered env values, some of which came from secret
// schema fields — never echo them. The key list is still useful for the UI
// ("this many variables will be set") without reproducing the values.
function redactPlan(plan) {
  if (!plan.spec) return plan;
  const { spec, ...rest } = plan;
  return { ...rest, spec: { ...spec, env: Object.keys(spec.env || {}) } };
}

function dockerFailure(res, err) {
  if (err instanceof DockerError) {
    return res.status(err.status && err.status < 500 ? err.status : 502).json({ error: err.message });
  }
  throw err;
}

// Runs a plan-shaped operation as a background job, answering immediately.
// Several applies restart the network this very request is being served over,
// so none of them may be a synchronous held-open request.
function startJob(res, label, work) {
  const job = createJob(label);
  res.status(202).json({ jobId: job.id });

  (async () => {
    try {
      await work((line) => appendLog(job, line));
      finishJob(job, null);
    } catch (err) {
      appendLog(job, `Error: ${err.message}`);
      finishJob(job, err);
    }
  })();
}

export function createStackRouter() {
  const router = Router();

  // Cheap and safe to poll: tells the UI whether to even attempt a plan.
  router.get("/docker/status", async (req, res) => {
    let reachable = false;
    try {
      reachable = await ping();
    } catch {
      reachable = false;
    }
    res.json({ reachable });
  });

  // Stack-wide settings. Only one for now, but it is the one that changes the
  // shape of every other component's spec.
  function stackSettings() {
    const dataPath = getDataPath();
    const cachePath = getCachePath();
    return {
      vpnEnabled: isVpnEnabled(),
      dataPath,
      cachePath,
      // Reported rather than enforced on read, so the page can explain a path
      // that is set but unreachable instead of only refusing to save it.
      dataPathError: dataPath ? validatePath(dataPath, "The stack data path") : null,
      cachePathError: cachePath ? validatePath(cachePath, "The cache path") : null,
      runsAs: ownershipString(),
    };
  }

  router.get("/settings", (req, res) => {
    res.json(stackSettings());
  });

  router.put("/settings", (req, res) => {
    const errors = [];

    // Paths are validated before being stored: a path the Suite cannot see is
    // a message on this form, rather than a container that fails to start with
    // an error naming none of this.
    for (const [key, label] of [
      ["dataPath", "The stack data path"],
      ["cachePath", "The cache path"],
    ]) {
      const value = req.body?.[key];
      if (value === undefined) continue;
      const problem = validatePath(value, label);
      if (problem) errors.push({ key, message: problem });
    }

    if (errors.length > 0) return res.status(400).json({ errors });

    if (typeof req.body?.vpnEnabled === "boolean") {
      setSetting(VPN_ENABLED_SETTING, req.body.vpnEnabled ? "true" : "false");
    }
    setPaths({ dataPath: req.body?.dataPath, cachePath: req.body?.cachePath });

    res.json(stackSettings());
  });

  // Every kind the Suite knows about, and whether it is currently part of the
  // stack. The UI needs both: a switched-off kind still has a form.
  router.get("/components", (req, res) => {
    const active = new Set(activeComponents().map((node) => node.kind));
    res.json({
      components: catalogKinds().map((kind) => {
        const entry = getCatalogEntry(kind);
        return {
          kind,
          label: entry.label,
          description: entry.description,
          active: active.has(kind),
        };
      }),
    });
  });

  router.get("/components/:kind", componentOr404, (req, res) => {
    const { schema, label, description } = req.componentEntry;
    const values = getComponentValues(req.params.kind, req.componentKey);
    res.json({
      kind: req.params.kind,
      key: req.componentKey,
      label,
      description,
      active: !!activeNode(req.params.kind, req.componentKey),
      fields: toPublicFields(schema, values),
    });
  });

  router.put("/components/:kind", componentOr404, (req, res) => {
    const { schema } = req.componentEntry;
    const existing = getComponentValues(req.params.kind, req.componentKey);
    const next = applyPatch(schema, existing, req.body || {});

    const errors = validate(schema, next);
    if (errors.length > 0) return res.status(400).json({ errors });

    saveComponentValues(req.params.kind, next, req.componentKey);
    res.json({ fields: toPublicFields(schema, next) });
  });

  // The whole stack, ordered, with the cascade applied. Read-only and
  // side-effect-free, so the frontend can call it on every load of the page.
  router.get("/plan", async (req, res) => {
    try {
      const { plans, summary } = await planStack();
      res.json({ plans: plans.map(redactPlan), summary, vpnEnabled: isVpnEnabled() });
    } catch (err) {
      dockerFailure(res, err);
    }
  });

  router.post("/apply", async (req, res) => {
    let plans;
    try {
      ({ plans } = await planStack());
    } catch (err) {
      return dockerFailure(res, err);
    }

    startJob(res, "stack", (log) => applyStack(plans, { log }));
  });

  // Read-only single-component plan, for the per-component card.
  router.get("/components/:kind/plan", componentOr404, async (req, res) => {
    const node = activeNode(req.params.kind, req.componentKey);
    if (!node) {
      return res.status(409).json({ error: `${req.params.kind} is not part of the stack right now` });
    }

    const values = getComponentValues(req.params.kind, req.componentKey);
    const errors = validate(node.schema, values);
    if (errors.length > 0) return res.status(400).json({ errors, incomplete: true });

    try {
      const plan = await planComponent(node, await node.render(values, node.key));
      res.json(redactPlan(plan));
    } catch (err) {
      dockerFailure(res, err);
    }
  });

  router.post("/components/:kind/apply", componentOr404, async (req, res) => {
    const node = activeNode(req.params.kind, req.componentKey);
    if (!node) {
      return res.status(409).json({ error: `${req.params.kind} is not part of the stack right now` });
    }

    const values = getComponentValues(req.params.kind, req.componentKey);
    const errors = validate(node.schema, values);
    if (errors.length > 0) return res.status(400).json({ errors });

    const takeover = !!req.body?.takeover;

    startJob(res, req.params.kind, async (log) => {
      const plan = await planComponent(node, await node.render(values, node.key));
      log(`Plan: ${plan.action}.`);
      await applyPlan(plan, { log, takeover });
    });
  });

  // --- instances ------------------------------------------------------------
  //
  // Instances are the first kind of which there can be several, so unlike the
  // singletons they need creating and removing rather than only configuring.

  router.get("/instances", (req, res) => {
    res.json({
      instances: listComponents("instance").map((row) => {
        const values = JSON.parse(row.config_json);
        return {
          key: row.key,
          displayName: values.displayName || row.key,
          containerName: instanceContainerName(row.key, values),
          port: Number(values.port) || null,
          // Computed, never typed — see reconcile/instance.js.
          url: instanceUrl(row.key, values),
          databaseName: values._dbName || null,
        };
      }),
      portBand: PORT_BAND,
    });
  });

  router.post("/instances", (req, res) => {
    const { schema } = getCatalogEntry("instance");
    const values = applyPatch(schema, {}, req.body || {});

    const errors = validate(schema, values);
    if (errors.length > 0) return res.status(400).json({ errors });

    try {
      const { key, port } = provisionInstance(values);
      res.status(201).json({ key, port });
    } catch (err) {
      res.status(409).json({ error: err.message });
    }
  });

  // Removing an instance takes it out of the stack, which turns its running
  // container into an orphan the plan then offers to remove. The database is a
  // separate decision and is kept unless dropDatabase is asked for outright.
  router.post("/instances/:key/remove", (req, res) => {
    const key = req.params.key;
    if (listComponents("instance").every((row) => row.key !== key)) {
      return res.status(404).json({ error: `Unknown instance: ${key}` });
    }

    const dropData = req.body?.dropDatabase === true;
    startJob(res, `remove ${key}`, (log) => deprovisionInstance(key, { dropData, log }));
  });

  // Proves the administrator credentials work before an instance depends on
  // them, the same way the instance form's connection test does.
  router.post("/database/test", async (req, res) => {
    const values = getComponentValues("postgres");
    const target = connectionTarget(values);
    if (!target.host) {
      return res.status(400).json({ ok: false, error: "No database host is configured yet." });
    }
    res.json(await testConnection(target));
  });

  // Removing an orphan is its own action, never part of an apply — the
  // reconciler does not destroy containers it can no longer describe unless
  // asked to in as many words.
  router.post("/orphans/remove", (req, res) => {
    const containerId = String(req.body?.containerId || "");
    if (!containerId) return res.status(400).json({ error: "containerId is required" });

    startJob(res, "orphan", (log) => removeOrphan(containerId, { log }));
  });

  router.get("/jobs/:jobId", (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Unknown job" });
    res.json(job);
  });

  return router;
}
