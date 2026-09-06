// Shared by every wizard/page step that applies one action to several
// instances at once via Promise.allSettled: names which ones failed and why,
// rather than failing the whole step over one bad instance.
export function describeFailures(targets, results) {
  const failed = results
    .map((r, idx) => ({ r, instance: targets[idx] }))
    .filter(({ r }) => r.status === "rejected");
  if (failed.length === 0) return null;
  return `Failed on ${failed
    .map(({ instance, r }) => {
      const detail = r.reason.body?.errors?.map((e) => e.message).join(" ") || r.reason.message;
      return `${instance.name} (${detail})`;
    })
    .join(", ")}`;
}
