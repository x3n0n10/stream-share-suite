// One type for the messages the Suite itself makes. The English `message` is
// always sent; `code` and `params` are additive, so the web app can translate
// it. Validators return one (not thrown); code that fails throws one.
export class SuiteError extends Error {
  constructor(code, message, params = {}) {
    super(message);
    this.name = "SuiteError";
    this.code = code;
    this.params = params;
  }
}

// `err` is a SuiteError, or any Error from outside the Suite (relayed as is,
// with no code). `extra` carries `ok`, `setupRequired` and the like.
export function sendError(res, status, err, extra = {}) {
  const body = { error: err.message };
  if (err instanceof SuiteError) {
    body.code = err.code;
    body.params = err.params;
  }
  return res.status(status).json({ ...body, ...extra });
}

// A 400 for a failed schema validation. `kind` lets the web app find each
// field's label; `extra` carries `incomplete` and the like.
export function sendFieldErrors(res, errors, kind, extra = {}) {
  return res.status(400).json({ errors, kind, ...extra });
}

export const UNKNOWN_INSTANCE = new SuiteError("unknown_instance", "Unknown instance");
export const UNKNOWN_JOB = new SuiteError("unknown_job", "Unknown job");

export const kindNotActive = (kind) =>
  new SuiteError("kind_not_active", `${kind} is not part of the stack right now`, { kind });
export const unknownInstanceKey = (key) =>
  new SuiteError("unknown_instance_key", `Unknown instance: ${key}`, { key });
