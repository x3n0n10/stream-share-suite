import { createContext, useContext } from "react";
import { api } from "./api.js";
import { usePolling } from "./usePolling.js";

const ActiveStreamsContext = createContext(0);

// Polls the active-stream count once for the whole app, above the routes, so
// the sidebar badge keeps its number while you move between pages instead of
// starting from nothing on each one.
export function ActiveStreamsProvider({ pollIntervalMs, children }) {
  const { data } = usePolling(() => api.activeStreams(), pollIntervalMs);
  return <ActiveStreamsContext.Provider value={data?.activeStreams ?? 0}>{children}</ActiveStreamsContext.Provider>;
}

export function useActiveStreams() {
  return useContext(ActiveStreamsContext);
}
