# List input: chips for comma-separated fields

## Problem

Several settings are comma-separated lists typed into a plain text box: the
VPN watchdog check times, gluetun's preferred server hostnames, and the
Docker networks of every component. A text box hides the structure, gives no
feedback on bad entries, and makes time values like `04:00,16:00` easy to get
wrong.

## Goal

One reusable chips control for any comma-separated value, usable from the
schema-driven forms and from hand-written pages. The stored value stays a
comma string, so storage, env rendering and API payloads do not change.

## Design

### `web/src/components/ListInput.jsx`

Props: `value` (comma string), `onChange(string)`, `itemType`, `sort`,
`placeholder`.

- Parses `value` into items (split on `,`, trim, drop empties) and shows each
  as a pill with a remove button (`aria-label="Remove <item>"`).
- `itemType` selects the entry control:
  - `"text"` (default): a trailing text input. Enter or `,` commits the item,
    Backspace on an empty input removes the last chip, and pasting `a,b,c`
    splits into several chips.
  - `"number"`: same, but only digits are accepted.
  - `"time"`: a `+ Add time` button reveals a native `<input type="time">`;
    committing (Enter or change) adds `HH:MM`.
- Duplicates are ignored. `sort` (off by default) keeps the list ordered,
  used for times. Without it, insertion order is kept, which matters for
  `networks` (the first is the primary network) and hostnames.
- Emits the items joined with `,` on every change. Styling follows the
  existing slate/accent palette, with dark-mode variants.

### Schema-driven forms

- New field type `list` with optional `itemType` and `sort`.
- `registry.js` `toPublicFields` exposes `itemType` and `sort`. Validation
  treats `list` like `text`; required/empty behaviour is unchanged.
- `SchemaForm.jsx`: `renderControl` gets a `list` branch rendering
  `ListInput`; `list` joins `multiControl` (wrapper is a `<div>`, not a
  `<label>`, since the control holds several buttons) and spans both columns.

### Fields converted

| Field | Component | `itemType` | `sort` |
|---|---|---|---|
| `serverHostnames` | gluetun | text | no |
| `serverCategories` | gluetun | text | no |
| `serverRegions` | gluetun | text | no |
| `networks` | gluetun, postgres, caddy | text | no |
| `healthCheckBlockedCodes` | instance | number | no |

### Watchdog check times

`Vpn.jsx` and `setup/StepHealthCheck.jsx` are not schema-driven, so they use
`<ListInput itemType="time" sort />` directly (caption `<span>` plus the
control, no wrapping `<label>`). The existing server validation
(`parseCheckTimes`, 400 on empty) stays the source of truth. `Vpn.jsx`
disables Save and shows "At least one time is required" while the list is
empty.

## Out of scope

Drag-to-reorder, per-item validation beyond the `itemType` input filter (the
server validators stay authoritative), a 24-hour timeline picker.

## Risks and notes

- The dirty check in `Vpn.jsx` compares strings. A stored unsorted value
  (e.g. `16:00,04:00`) will look changed once the user edits the field,
  because the component emits sorted output. Acceptable.
- Existing stored values with spaces (`a, b`) render fine and are normalised
  to `a,b` on first edit.
- The web package has no test setup; verification is manual in the running
  app (add, remove, duplicate, paste, save; light and dark mode), plus the
  server's existing tests for the schema registry.
