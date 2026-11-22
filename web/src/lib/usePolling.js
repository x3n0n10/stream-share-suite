import { useCallback, useEffect, useRef, useState } from "react";

// Runs `fetcher` immediately, then again every `intervalMs`. Keeps the last
// successful data on screen if a poll fails, and reports the failure
// separately so the UI can show a subtle "stale data" hint instead of
// blanking out.
export function usePolling(fetcher, intervalMs, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(async () => {
    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(null);
      setUpdatedAt(new Date());
    } catch (err) {
      // Keep the error object so the page can translate it at render; the same failure
      // again keeps the old object, so React skips the re-render.
      setError((prev) => (prev && prev.message === err.message && prev.body?.code === err.body?.code ? prev : err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer;

    async function tick() {
      if (cancelled) return;
      await refresh();
      if (!cancelled) timer = setTimeout(tick, intervalMs);
    }

    setLoading(true);
    tick();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);

  return { data, error, loading, updatedAt, refresh };
}
