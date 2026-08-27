import { createContext, useContext } from "react";

const ConfigContext = createContext(null);

export function ConfigProvider({ config, children }) {
  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>;
}

// Config isn't fetched yet on first render, so callers get null until it
// resolves -- always fall back to a sensible default rather than assuming
// a value is present.
export function useConfig() {
  return useContext(ConfigContext);
}
