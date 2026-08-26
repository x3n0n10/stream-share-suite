// The reconciler's HTTP surface: configure a component's desired state, see
// what applying it would do, and apply it as a background job with a
// pollable log.
//
// Registering a new component kind here is the one place phase 2 has to
// touch to add instances, Caddy, or UHF to this machinery — everything else
// in this file is already generic over "kind".

import { Router } from "express";
import { GLUETUN_SCHEMA } from "../schema/gluetun.js";
import { validate, toPublicFields, applyPatch } from "../schema/registry.js";
import { getComponentValues, saveComponentValues } from "../store/components.js";
import { renderGluetunSpec } from "../reconcile/gluetun.js";
import { planComponent, applyPlan } from "../reconcile/reconciler.js";
import { createJob, appendLog, finishJob, getJob } from "../reconcile/jobs.js";
import { ping, DockerError } from "../docker/client.js";

const COMPONENTS = {
  gluetun: { schema: GLUETUN_SCHEMA, render: renderGluetunSpec },
};

function componentOr404(req, res, next) {
  const entry = COMPONENTS[req.params.kind];
  if (!entry) return res.status(404).json({ error: `Unknown component kind: ${req.params.kind}` });
  req.componentEntry = entry;
  next();
}

// A plan's spec carries rendered env values, some of which came from secret
// schema fields — never echo them. The key list is still useful for the UI
// ("this many variables will be set") without reproducing the values.
function redactPlan(plan) {
  const { spec, ...rest } = plan;
  return { ...rest, spec: { ...spec, env: Object.keys(spec.env || {}) } };
}

function dockerFailure(res, err) {
  if (err instanceof DockerError) {
    return res.status(err.status && err.status < 500 ? err.status : 502).json({ error: err.message });
  }
  throw err;
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

  router.get("/components", (req, res) => {
    res.json({
      components: Object.entries(COMPONENTS).map(([kind, { schema }]) => ({ kind, label: schema.label })),
    });
  });

  router.get("/components/:kind", componentOr404, (req, res) => {
    const { schema } = req.componentEntry;
    const values = getComponentValues(req.params.kind);
    res.json({ kind: req.params.kind, label: schema.label, fields: toPublicFields(schema, values) });
  });

  router.put("/components/:kind", componentOr404, (req, res) => {
    const { schema } = req.componentEntry;
    const existing = getComponentValues(req.params.kind);
    const next = applyPatch(schema, existing, req.body || {});

    const errors = validate(schema, next);
    if (errors.length > 0) return res.status(400).json({ errors });

    saveComponentValues(req.params.kind, next);
    res.json({ fields: toPublicFields(schema, next) });
  });

  // Read-only and side-effect-free: safe for the frontend to call on every
  // load of the page, the way it already polls /api/overview.
  router.get("/components/:kind/plan", componentOr404, async (req, res) => {
    const { schema, render } = req.componentEntry;
    const values = getComponentValues(req.params.kind);

    const errors = validate(schema, values);
    if (errors.length > 0) return res.status(400).json({ errors, incomplete: true });

    try {
      const spec = await render(values);
      const plan = await planComponent(req.params.kind, spec);
      res.json(redactPlan(plan));
    } catch (err) {
      dockerFailure(res, err);
    }
  });

  // Starts a background job and returns immediately — several applies can
  // restart the network the Suite is answering this request over, so this
  // must never be a synchronous, held-open request.
  router.post("/components/:kind/apply", componentOr404, async (req, res) => {
    const { schema, render } = req.componentEntry;
    const values = getComponentValues(req.params.kind);

    const errors = validate(schema, values);
    if (errors.length > 0) return res.status(400).json({ errors });

    const takeover = !!req.body?.takeover;
    const job = createJob(req.params.kind);
    res.status(202).json({ jobId: job.id });

    (async () => {
      try {
        const spec = await render(values);
        const plan = await planComponent(req.params.kind, spec);
        appendLog(job, `Plan: ${plan.action}.`);
        await applyPlan(plan, { log: (line) => appendLog(job, line), takeover });
        finishJob(job, null);
      } catch (err) {
        appendLog(job, `Error: ${err.message}`);
        finishJob(job, err);
      }
    })();
  });

  router.get("/jobs/:jobId", (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Unknown job" });
    res.json(job);
  });

  return router;
}
