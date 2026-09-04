import { useEffect, useRef, useState } from "react";

// Polls a job by id via `fetchJob` every `intervalMs` until it leaves the
// "running" state, then calls `onDone` with the final job. Same
// recursive-setTimeout shape as usePolling, but driven by an id handed to
// `poll()` rather than running continuously from mount.
export function useJobPolling(fetchJob, intervalMs, onDone) {
  const [job, setJob] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  function poll(jobId) {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      const current = await fetchJob(jobId).catch(() => null);
      if (!current) return;
      setJob(current);
      if (current.status === "running") poll(jobId);
      else onDone?.(current);
    }, intervalMs);
  }

  return { job, setJob, poll };
}
