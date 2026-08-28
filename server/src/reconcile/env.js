// The extraEnv escape hatch, shared by every component that offers one.
//
// It exists so an unmodelled setting never blocks a deployment: gluetun
// supports around forty VPN providers and stream-share reads roughly fifty
// variables, and modelling all of both would be a worse form than modelling
// the ones that decide whether the thing runs.
//
// Malformed lines are dropped rather than rejected — blank lines, "#"
// comments, anything without an "=" — because the whole point of the field is
// that it cannot be the reason an apply fails. Callers must spread it BEFORE
// the schema's own rendered env, so a named field always wins over a stray
// line here and a typo in a real field stays a save-time validation error
// rather than being silently shadowed.
export function parseExtraEnv(raw) {
  const env = {};
  for (const line of String(raw || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}
