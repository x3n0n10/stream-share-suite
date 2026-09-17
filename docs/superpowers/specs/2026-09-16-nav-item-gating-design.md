# Nav item gating (hide irrelevant pages)

## Problem

`NAV_ITEMS` in [Layout.jsx](../../../web/src/components/Layout.jsx) always renders every page link — desktop sidebar, mobile drawer, and mobile bottom nav — even when the linked page has nothing to show yet:

- With zero instances configured, Users / History / Leaderboard / VOD search / Aliases are all empty or broken (they operate on instance data that doesn't exist).
- VPN page only matters once gluetun is actually reachable — `config.gluetun.enabled` already means exactly this (see [routes/index.js:34](../../../server/src/routes/index.js)'s own comment: "whether the VPN page should appear at all"). Instance count is irrelevant to VPN — a bare gluetun tunnel can be turned on before any instance exists.

## Data already available

`useConfig()` (`web/src/lib/ConfigContext.jsx`) already exposes, from `GET /api/config`:

- `config.instances` — array, so `config.instances.length > 0` is "has instances"
- `config.gluetun.enabled` — bool, "VPN page usable"

No new API, no backend change. Frontend-only.

## Design

In `web/src/components/Layout.jsx`:

1. Tag gated entries in `NAV_ITEMS`:
   - `requiresInstances: true` — Users, History, Leaderboard, VOD search, Aliases
   - `requiresVpn: true` — VPN (instance count irrelevant here)
   - no tag — Overview, Instances, Setup wizard, Stack, Settings (always visible)

2. In `Layout()`:
   ```js
   const hasInstances = (config?.instances?.length ?? 0) > 0;
   const vpnAvailable = !!config?.gluetun?.enabled;
   const visibleNavItems = NAV_ITEMS.filter((item) =>
     item.separator ||
     ((!item.requiresInstances || hasInstances) && (!item.requiresVpn || vpnAvailable))
   );
   ```

3. `NavList` currently reads the module-level `NAV_ITEMS` constant directly — change it to take `items` as a prop, and pass `visibleNavItems` from both the desktop `<aside>` and the mobile drawer (both already call `<NavList />` separately, same data).

4. `MOBILE_NAV_ITEMS` is currently a static module-level filter of `NAV_ITEMS` by path (`["/", "/history", "/vpn", "/vod"]`). Since History and VPN are now conditionally gated, this can no longer be computed once at module load — derive it from `visibleNavItems` inside `Layout()` each render, filtering by the same path list.

## Edge cases

- **Config not loaded yet** (`useConfig()` returns `null` on first render): both `hasInstances` and `vpnAvailable` default to `false`, so gated items are hidden until config resolves, then appear. No flash of a broken link. Accepted as-is, no loading-state special case needed.
- **Separator row**: sits between VOD search and Aliases in `NAV_ITEMS`. In the zero-instance case, Overview/Instances remain visible before it and Setup wizard/Stack/Settings remain visible after it, so it's never orphaned at the top or bottom of the list. Not worth generalizing further (no dedupe/collapse logic) since the concrete item set doesn't produce an orphan.
- **Mobile bottom nav with fewer visible items**: no backfill to keep 4 slots full — fewer icons is fine, rest stay reachable via drawer.

## Out of scope

- No route-level guard (a user typing `/history` directly with zero instances still reaches the page). Nav hiding only. Can be added later as a separate change if wanted.

## Verification

No test framework in `web/` (build + manual walkthrough is the existing pattern). Verify by hand:
- 0 instances, VPN off → only Overview/Instances/Setup wizard/Stack/Settings shown, in sidebar, drawer, and bottom nav.
- 0 instances, VPN on → VPN also shown.
- Instances present, VPN off → Users/History/Leaderboard/VOD search/Aliases shown, VPN hidden.
- `npm run build` in `web/` succeeds.
