import { errorText } from "./serverText.js";

// Shared by every wizard/page step that applies one action to several
// instances at once via Promise.allSettled: names which ones failed and why,
// rather than failing the whole step over one bad instance.
export function describeFailures(targets, results, t) {
  const failed = results
    .map((r, idx) => ({ r, instance: targets[idx] }))
    .filter(({ r }) => r.status === "rejected");
  if (failed.length === 0) return null;
  const list = failed
    .map(({ instance, r }) => `${instance.name} (${errorText(r.reason, t)})`)
    .join(", ");
  return t("common.failedOn", { list });
}
