# Stack page redesign

## Context

`web/src/pages/Stack.jsx` is 1055 lines, 16 components, and reads as a
single long scroll mixing five distinct concerns in this order:

1. **Settings** — VPN on/off, Caddy on/off, instance port range
   (`StackSettings`, `OptionalComponentToggle`, `PortRangeSetting`)
2. **Plan** — the diff between stored config and real Docker state, plus
   the Apply button (`PlanCard`, `PlanSummary`, `PlanRow`, `EmptyPlan`)
3. **Job log** — appears while Apply/check-for-updates runs (`JobLog`)
4. **Import** — scan running containers, adopt them (`ImportCard`)
5. **Instances** — list, add/edit/remove, check-for-updates
   (`InstancesCard`, `RemoveInstanceDialog`)
6. **Components** — one generic card per gluetun/postgres/caddy, each with
   its own Configure/Close collapse, config form, check-for-updates,
   history (`ComponentCard`, `HistoryPanel`)

Pain point (confirmed with the user): too much scrolling, hard to find
things. Not a visual/styling complaint — the information architecture
itself needs reorganizing.

Key insight from discussion: the Plan isn't one section among five — it's
the live "here's what this will do" summary of everything else. It should
stay visible while editing anything, not compete for scroll position with
the things it's summarizing.

## Goals

- Kill the mega-scroll: show one section at a time instead of stacking all
  of them vertically.
- Keep the Plan (and Apply, and the job log) visible at all times on
  desktop, regardless of which other section is being edited.
- Attach each setting to the component it actually controls, instead of a
  separate "Settings" grab-bag.
- No backend changes. This is a frontend reorganization only — every API
  call (`api.saveStackSettings`, `api.saveComponent`, `api.stackComponents`,
  etc.) keeps its current shape and behavior.

## Non-goals

- No new routes — stays one page at `/stack`, no deep-linkable tab state
  (matches the Setup wizard's own precedent: step state is local, not
  URL-driven).
- No visual/styling redesign beyond what naturally falls out of the new
  structure (tab bar, two-pane grid). Not a "make it pretty" pass.
- No change to `SchemaForm`, `registry.js`, or any schema file.

## Layout

**Desktop (`lg:` / 1024px and up):** two-pane.

```
lg:grid lg:grid-cols-[1fr_380px] lg:gap-4
```

Left pane: tab content (see Tabs, below), full-width, scrolls independently
as its content requires. Right pane: `PlanPanel`, `lg:sticky lg:top-6` —
stays in view while the left pane scrolls. `Layout.jsx`'s own header is a
separate fixed bar above `<main>`, not inside its scroll, so `top-6` alone
is correct without any header-height arithmetic.

**Below `lg:`:** single column. No sticky rail — Plan becomes a 4th tab
instead, since there's no room for a persistent side panel.

**Tab bar:** a real tab strip — bottom-border active indicator, accent
color — visually distinct from the pill-button toggles used elsewhere in
the app (Xtream/M3U, sign-in mode) that pick a single value. This is
section navigation, a different affordance.

## Tabs

**Desktop:** Instances, Components, Import (3 tabs) + the persistent Plan
rail. **Mobile:** Instances, Components, Import, Plan (4 tabs). Default
tab: **Instances**.

### Instances tab

Port range setting (`PortRangeSetting`, unchanged internals — reads/writes
`settings.instancePortStart` via `api.saveStackSettings`) sits above the
instance list, since it governs how instances are allocated. Everything
below it is today's `InstancesCard` content unchanged: list, add, edit,
remove, check-for-updates. `RemoveInstanceDialog`'s open/closed state moves
from the page orchestrator into this tab's own component (see State
ownership, below).

### Components tab

Three dedicated cards, not one generic `ComponentCard` parameterized over
`component.kind`. Each shares the same three pieces (config form via
`SchemaForm`, `HistoryPanel`, check-for-updates button) but only
`GluetunCard` and `CaddyCard` carry an on/off toggle — `PostgresCard` has
none, since managed-vs-external is a different axis with no "off" state.

- **`GluetunCard`** — "Route traffic through a VPN" toggle, moved here
  verbatim from `StackSettings` (same copy, same
  `settings.vpnEnabled`/`api.saveStackSettings` read/write path) + gluetun's
  config form + history + check-for-updates + takeover-if-available.
- **`CaddyCard`** — "Publish instances through Caddy" toggle, moved here
  verbatim from `StackSettings`'s `OptionalComponentToggle` (same
  `settings.caddyEnabled` path) + same set of pieces.
- **`PostgresCard`** — same set of pieces, no toggle.

**Configure/Close collapse removed.** Today's `ComponentCard` hides its
config form behind a Configure/Close toggle — that existed to keep the old
single-scroll page shorter. In a dedicated Components tab, that reason is
gone; each card shows its config form directly, same as how a Setup wizard
step already shows one full form with no collapse. `SchemaForm`'s own
Advanced-fields `<details>` collapse (inside the form) is untouched — only
the outer per-card collapse goes away. History stays its own collapse —
genuinely rare-use, unlike the primary config form.

`ComponentsTab.jsx` is the thin piece that maps the `components` list
(from `api.stackComponents()`) to the right dedicated card by
`component.kind`.

### Import tab

Today's `ImportCard` content, unchanged internals, renamed file only.

### Plan panel (rail on desktop, 4th tab on mobile)

Today's `PlanCard` + `PlanSummary` + `PlanRow` + `EmptyPlan` + `JobLog`,
combined into one `PlanPanel` component so it can be rendered in exactly
two places (the sticky rail, the mobile tab) without duplicating markup.
Owns the orphan-removal confirm dialog's open/closed state locally (moved
from the orchestrator — see below); calls an `onRemoveOrphan(row)` prop,
supplied by the orchestrator, only once the user actually confirms.

`EmptyPlan`'s copy needs a small fix while it moves: today it reads
"Configure a component below to get started" — true only in the old
single-scroll layout, where Components was literally below Plan. Under the
new layout Plan sits beside (desktop) or on its own tab from (mobile)
Components, not below it. Replace with wording that names the tab instead
of a spatial direction, e.g. "Configure a component under the Components
tab to get started."

## File structure

Mirrors how `pages/setup/` already splits wizard steps into per-step
files with `Setup.jsx` as a slim orchestrator — same convention, applied
here.

```
pages/Stack.jsx               — state, data fetching, tab switch, two-pane/tab shell
pages/stack/InstancesTab.jsx  — port range + instance list/CRUD + its own remove-confirm dialog
pages/stack/GluetunCard.jsx
pages/stack/PostgresCard.jsx
pages/stack/CaddyCard.jsx
pages/stack/ComponentsTab.jsx — renders the three cards, maps by component.kind
pages/stack/ImportTab.jsx
pages/stack/PlanPanel.jsx     — plan diff, Apply, job log, its own orphan-remove confirm dialog
pages/stack/HistoryPanel.jsx  — shared by all three cards (already reused today, same content)
```

`ActionBadge`/`RuntimeBadges` (currently module-level in `Stack.jsx`, used
only by `PlanRow`) move into `PlanPanel.jsx` alongside it — no other
consumer. `RemoveInstanceDialog` moves into `InstancesTab.jsx` — no other
consumer.

## State ownership

Orchestrator (`Stack.jsx`) keeps exactly what it needs to coordinate
across tabs and gate concurrent actions:

```
dockerReachable, components, settings, instances, portBand,
plan, planError, busy, job, activeTab
```

Everything dialog-specific moves into whichever component owns that
dialog — today's `Stack.jsx` holds every dialog's open/closed state
itself (`orphanToRemove`, `instanceToRemove`, `dropDatabase`); after this
change, `InstancesTab` owns its own remove-instance dialog state,
`PlanPanel` owns its own remove-orphan dialog state. Both still call back
into the orchestrator to actually perform the removal — `busy`/`job` stay
orchestrator-level since a running job has to disable job-triggering
buttons across every tab at once, not just the tab it started from.

No new state mechanism (no Context, no state library) — plain props,
matching the rest of the app's existing style. Tab switching is local
`useState` in `Stack.jsx`, conditionally rendering one tab's component at
a time (same pattern `Setup.jsx` already uses for its steps) rather than
mounting all four and hiding three with CSS — avoids background work for
tabs that aren't visible, though in practice none of these tabs run
background effects independent of their own open/closed sub-state anyway.

## Out of scope

- Any change to `SchemaForm.jsx`, `registry.js`, or any `schema/*.js` file.
- Any change to what data the API returns or how it's shaped — this is a
  pure client-side reorganization of existing data into a new layout.
- Deep-linkable tab state (e.g. `/stack?tab=components`) — not requested,
  and the Setup wizard's own step state isn't URL-driven either.
- Visual restyling beyond what the new structure requires (tab bar,
  two-pane grid, sticky rail). Not a design-system pass.

## Testing

No frontend test runner exists in this repo (confirmed: only
`server/test/*.test.js`, driven by `node --test`). Verification is
`npm run build` staying clean plus a careful read-through of each new
file's JSX against this spec — the same method used for every other
frontend-only change this session (the wizard steps, the icon-button
conversion).
