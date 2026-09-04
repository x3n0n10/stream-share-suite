# Design system foundation

## Context

The dashboard's UI is functionally complete through phase 4c, but reads as a
generic Tailwind admin panel — no visual identity of its own. This is the
first of three planned UI passes:

1. **Design system foundation** (this spec) — color, type, shape, and the
   shared components every page already consumes.
2. Navigation & page structure (follow-on, not yet designed).
3. Flow-specific simplification — Stack and Setup in particular (follow-on,
   not yet designed).

This spec covers only (1). It re-skins the app by changing shared tokens and
components; it does not restructure navigation or redesign any individual
page's layout.

## Why this is scoped the way it is

Every page (`Overview`, `History`, `Leaderboard`, `Users`, `Instances`,
`Aliases`, `Vpn`, `Stack`, `Settings`, `Setup`, `SignIn`, `Vod`) already
renders through a small set of shared pieces: `Card`, `Button`, `Badge`,
`StatTile`, `StatusDot`, `RefreshButton`, `PollStatus`, `FIELD`, and table
markup, all living in `web/src/components/common.jsx`, plus `Layout.jsx` for
the sidebar/header chrome. Re-theming those, plus the Tailwind config and
global CSS, re-skins every page without touching per-page code. That's the
entire footprint of this phase:

- `web/tailwind.config.js`
- `web/src/index.css`
- `web/src/components/common.jsx`
- `web/src/components/Layout.jsx`

No page component changes. No new dependencies — Manrope and Inter are both
free, self-hostable Google Fonts; existing icons and layout structure are
kept as-is.

## Brand color

`web/public/logo.svg` already exists and is already wired up in
`Layout.jsx`'s sidebar/drawer header — it just isn't reflected anywhere else
in the app. Its colors become the app's single accent scale:

- Primary green: `#65c86b`
- Mint highlight: `#9bf89f`
- Dark canvas gradient: `#0d1914` → `#030906`

### Accent scale

Replaces the current `accent` (blue) entry in `tailwind.config.js`'s
`theme.extend.colors`. The two brand hexes are fixed anchors; everything
else is a standard 50–900 ramp generated between/around them (any Tailwind
palette generator works) and tuned by eye — the exact intermediate hexes
aren't a design decision worth pinning here:

| Step | Hex | Primary use |
|------|-----|-------------|
| 300 | `#9bf89f` (fixed) | dark-mode headings, labels, badge text (logo mint) |
| 500 | `#65c86b` (fixed) | light-mode buttons/links (logo green) |
| 700 | generated, deep enough for white-text contrast | dark-mode button fill |

Remaining steps (50/100/200/400/600/800/900) follow from the ramp generator;
use them for tint backgrounds, hovers, and borders as each context needs.

### Merging brand and "success" green

The app currently has two greens: the blue `accent` (buttons, active nav,
links) and a separate `emerald` used via `Badge`/`StatTile`/`StatusDot`
`tone="green"` for "online"/"watching"/"success" states. This spec merges
them into the one scale above — a streaming dashboard where the brand color
*is* the "healthy/live" signal is a feature, not a collision, and it's one
fewer palette to maintain. `rose` (danger/offline) and `amber` (warning)
keep their current values; they don't conflict with green.

**Every existing `tone="green"` call site in `common.jsx` consumers now
resolves to the same `accent` scale instead of a separate emerald one** — no
call sites need to change, only the token they resolve to.

## Dark theme as default

`useTheme.js` currently falls back to `prefers-color-scheme` for a
first-time visitor with no stored choice. That fallback changes to always
be `"dark"`, regardless of system preference — the brand identity is dark
by design, not just by usual OS default. A returning visitor's stored
choice (`localStorage`) and the manual toggle are unaffected either way.

The dark theme itself is rebuilt on the logo's own near-black green-black
gradient (`#0d1914` → `#030906`, fixed — it's literally the logo's
background) rather than the current neutral slate. Surface, border, and
text values are a starting point, not pinned exactly — tune by eye against
the canvas the same way the shadow opacity below is tuned:

| Token | Starting point | Use |
|-------|-----|-----|
| Canvas | `#0b1310` (near the logo's own gradient) | page background |
| Surface | `#101d18` | cards, sidebar, header |
| Border | `#1e3229` | card/table borders, dividers |
| Text primary | `#eafbe9` | headings, high-emphasis text |
| Text muted | `#7c8f84` | labels, secondary text |

Light theme stays fully supported through the existing toggle. Its existing
canvas/surface/border/text values (white/slate-50 and friends) don't need to
change — they already read fine against green — but light mode does pick up
new accent-tinted treatments where this spec calls for them (see table
treatment below), the same as dark mode does.

## Typography

- **Inter** (already in use) stays for body text, table cells, and form
  labels.
- **Manrope**, weights 700/800, becomes the display face for page titles
  (`Layout`'s `<h1>`), section headings (`<h2>` in each page), and stat
  numbers (`StatTile`'s value).
- Both fonts are bundled as local font files (e.g. under
  `web/public/fonts/`) rather than loaded from Google's CDN at runtime — this
  is a self-hosted tool; it shouldn't make an external request just to
  render text.

## Shape & elevation

- Card radius stays `rounded-2xl` (16px) — already correct, no change.
- Card shadow changes from the current flat `shadow-sm` to a soft
  accent-tinted shadow — a blurred, low-opacity glow in the accent color
  (roughly 8-12% opacity) instead of a neutral gray shadow — matching the
  "confident" feel validated in mockups. Exact values are an implementation
  detail; tune by eye against both themes.

## Table / dense-page treatment

Table chrome (in the shared table classes used by `History`, `Users`,
`Aliases`, `Leaderboard`) picks up the accent too, not just badges and
buttons:

- Header row: a subtle accent-tinted background and accent-colored header
  text — light enough to read as a tint, not a solid fill. In dark mode
  that's a low-opacity wash of the accent color; in light mode, the
  lightest step of the accent ramp (`accent-50`) does the same job.
- Body rows: an even fainter alternating-row wash in the accent color, not
  a hard zebra stripe.
- Exact opacity/step values are implementation detail — tune by eye
  against both themes, same as the card shadow above.

## Icons

No change. The existing hand-drawn set in `Icons.jsx` already reads fine
against the new palette; redrawing ~20 icons is out of scope for a
token-level pass.

## Out of scope (deliberately)

- Any change to page layout, navigation structure, or the sidebar's item
  list — that's phase 2.
- Any change to the Stack or Setup pages' structure/flow — that's phase 3.
- Any new UI component that doesn't already exist in `common.jsx`.
- Light-mode-specific mockups beyond what's stated above — light mode reuses
  the accent scale and its own existing near-white backgrounds; if something
  reads poorly once implemented, fix it in review rather than block this
  spec on exhaustive light-mode mockups.
