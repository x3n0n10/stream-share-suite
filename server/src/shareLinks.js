// Shapes a stream-share instance's live share links for the Suite's API.
//
// The instance puts its own `urls` on each share, built from the request it
// saw — from here that is the internal address the Suite reaches it on, which
// is useless to a guest. Addresses are therefore built from the instance's
// public base URL instead, or reported as paths only when that is unknown.

export function shareAddresses(publicBaseUrl, token) {
  const paths = { playlist: `/share/${token}.m3u`, stream: `/share/${token}/live.ts` };
  const base = String(publicBaseUrl || "").replace(/\/+$/, "");
  const urls = base ? { playlist: base + paths.playlist, stream: base + paths.stream } : null;
  return { paths, urls };
}

export function shapeShare(raw, publicBaseUrl) {
  return {
    token: raw.token,
    streamId: raw.stream_id,
    title: raw.title,
    createdBy: raw.created_by,
    guest: raw.guest || "",
    startsAt: raw.starts_at,
    endsAt: raw.ends_at,
    revokedAt: raw.revoked_at || null,
    createdAt: raw.created_at,
    state: raw.state,
    ...shareAddresses(publicBaseUrl, raw.token),
  };
}
