import { useEffect, useState } from "react";

// Keeps a conditionally-rendered element mounted for `duration` ms after
// `active` goes false, so exit transitions get time to play instead of the
// element disappearing mid-animation.
export function useDelayedUnmount(active, duration) {
  const [mounted, setMounted] = useState(active);

  useEffect(() => {
    let timer;
    if (active) {
      setMounted(true);
    } else if (mounted) {
      timer = setTimeout(() => setMounted(false), duration);
    }
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, duration]);

  return mounted;
}
