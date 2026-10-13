# List Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace comma-separated text boxes with a reusable chips control (`ListInput`), wired into the schema-driven forms and the watchdog check-times fields.

**Architecture:** A pure helper module (`web/src/lib/listItems.js`) holds all parsing/normalising logic and is unit-tested with `node --test`. `ListInput.jsx` is a thin React view over it. The server exposes a new `list` field type (with `itemType`/`sort`) through `toPublicFields`; `SchemaForm` renders it. The stored value stays a comma string, so storage, env rendering and API payloads do not change.

**Tech Stack:** React 18 + Tailwind (web, Vite), Node 22 `node:test` (server and the new web helper test), no new dependencies.

## Global Constraints

- Stored/emitted value is always a comma-joined string with no spaces (`a,b,c`); never an array in storage or API payloads.
- No new dependencies in `server/package.json` or `web/package.json`.
- `networks` and hostnames keep insertion order (`sort` off); only check times use `sort`.
- Styling uses the existing slate/accent Tailwind palette with `dark:` variants; reuse `FIELD` from `web/src/components/common.jsx`.
- Server validators remain the source of truth; the component only filters input by `itemType`.
- Spec: `docs/superpowers/specs/2026-10-13-list-input-design.md`. One deliberate tightening versus the spec: the time entry commits on Enter or an explicit "Add" button (Escape cancels), not on every `change` event, because a native time picker fires `change` repeatedly while the user is still choosing.

## File Structure

| File | Responsibility |
|---|---|
| `web/src/lib/listItems.js` (new) | Pure functions: parse, normalise, add, remove, join |
| `web/test/listItems.test.js` (new) | Unit tests for the helper |
| `web/package.json` (modify) | Add `"test"` script |
| `web/src/components/ListInput.jsx` (new) | Chips control (view over the helper) |
| `server/src/schema/registry.js` (modify) | Expose `itemType` and `sort` in `toPublicFields` |
| `server/test/registry.test.js` (modify) | Test the exposure |
| `server/src/schema/{gluetun,postgres,caddy,instance}.js` (modify) | Mark fields `type: "list"` |
| `server/test/list-fields.test.js` (new) | Assert the converted fields |
| `web/src/components/SchemaForm.jsx` (modify) | Render `list` fields |
| `web/src/pages/Vpn.jsx`, `web/src/pages/setup/StepHealthCheck.jsx` (modify) | Use `ListInput` for check times |

## Parallelism

- **Task 1 (server) and Task 2 (web helper + component) are independent: run in parallel.**
- **Tasks 3 and 4 both consume Task 2's `ListInput` and touch different files: run in parallel after Task 2.**
- All tasks commit to branch `claude/intelligent-pasteur-xsxqj8`. Parallel agents must each `git add` only their own files and `git pull --rebase origin claude/intelligent-pasteur-xsxqj8` before pushing; the coordinator does the final push.

---

### Task 1: Server `list` field type and field conversion

**Files:**
- Modify: `server/src/schema/registry.js:174-186`
- Modify: `server/src/schema/gluetun.js` (fields `serverCategories`, `serverHostnames`, `serverRegions`, `networks`)
- Modify: `server/src/schema/postgres.js` (field `networks`)
- Modify: `server/src/schema/caddy.js` (field `networks`)
- Modify: `server/src/schema/instance.js` (field `healthCheckBlockedCodes`)
- Modify: `server/test/registry.test.js` (append)
- Create: `server/test/list-fields.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: public field objects from `toPublicFields` gain `itemType: string|null` and `sort: boolean`. Schema fields may declare `type: "list"`, `itemType: "text"|"number"|"time"`, `sort: true`.

- [ ] **Step 1: Install server dependencies**

Run: `cd server && npm ci`
Expected: completes without error.

- [ ] **Step 2: Write the failing tests**

Append to `server/test/registry.test.js`:

```js
test("toPublicFields exposes itemType and sort for list fields", () => {
  const schema = {
    kind: "widget",
    label: "Widget",
    fields: [
      { key: "times", envVar: null, label: "Times", type: "list", itemType: "time", sort: true },
      { key: "names", envVar: null, label: "Names", type: "list" },
    ],
  };
  const [times, names] = toPublicFields(schema, { times: "04:00", names: "a,b" });
  assert.equal(times.type, "list");
  assert.equal(times.itemType, "time");
  assert.equal(times.sort, true);
  assert.equal(names.itemType, null);
  assert.equal(names.sort, false);
});
```

Create `server/test/list-fields.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { GLUETUN_SCHEMA } from "../src/schema/gluetun.js";
import { POSTGRES_SCHEMA } from "../src/schema/postgres.js";
import { CADDY_SCHEMA } from "../src/schema/caddy.js";
import { INSTANCE_SCHEMA } from "../src/schema/instance.js";

const field = (schema, key) => schema.fields.find((f) => f.key === key);

test("comma-separated fields are declared as list fields", () => {
  const expected = [
    [GLUETUN_SCHEMA, "serverHostnames", "text"],
    [GLUETUN_SCHEMA, "serverCategories", "text"],
    [GLUETUN_SCHEMA, "serverRegions", "text"],
    [GLUETUN_SCHEMA, "networks", "text"],
    [POSTGRES_SCHEMA, "networks", "text"],
    [CADDY_SCHEMA, "networks", "text"],
    [INSTANCE_SCHEMA, "healthCheckBlockedCodes", "number"],
  ];
  for (const [schema, key, itemType] of expected) {
    const f = field(schema, key);
    assert.equal(f.type, "list", `${schema.kind}.${key} type`);
    assert.equal(f.itemType, itemType, `${schema.kind}.${key} itemType`);
    assert.ok(!f.sort, `${schema.kind}.${key} must keep insertion order`);
  }
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd server && node --test test/registry.test.js test/list-fields.test.js`
Expected: FAIL (`itemType` is `undefined`; fields have no `type`).

- [ ] **Step 4: Expose the new properties**

In `server/src/schema/registry.js`, inside `toPublicFields`'s `base` object, after the `optionLabels` line, add:

```js
      itemType: field.itemType || null,
      sort: !!field.sort,
```

- [ ] **Step 5: Convert the fields**

For each field below, add `type: "list",` and the `itemType` line directly after the `label` line.

`server/src/schema/gluetun.js` — `serverCategories`, `serverHostnames`, `serverRegions`, `networks`: add
```js
      type: "list",
      itemType: "text",
```
and change the hostnames help to `"This is the list a VPN healer would cycle through in a later phase."` (drop "Comma-separated.": chips make it obvious). For `networks` change help to start `"Names of existing Docker networks, e.g. vpnnet, ssbackend. The first one becomes ..."` keeping the rest of the sentence unchanged.

`server/src/schema/postgres.js` and `server/src/schema/caddy.js` — `networks`: add the same two lines and remove the leading `Comma-separated. ` from the help text.

`server/src/schema/instance.js` — `healthCheckBlockedCodes`: add
```js
      type: "list",
      itemType: "number",
```
and change help to `"HTTP status codes your provider returns when it's blocking this exit IP. Defaults to 456 (the common Xtream convention) when left blank."`

- [ ] **Step 6: Run the full server suite**

Run: `cd server && npm test`
Expected: all tests PASS (new tests included, no regressions; `gluetun.js`/`instance.js` reconcilers read `values.networks` as a string, unchanged).

- [ ] **Step 7: Commit**

```bash
git add server/src/schema server/test/registry.test.js server/test/list-fields.test.js
git commit -m "Add a list field type and convert comma-separated schema fields

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01La595mnRq7gqG2GomorCNG"
```

---

### Task 2: `listItems` helper and `ListInput` component

**Files:**
- Create: `web/src/lib/listItems.js`
- Create: `web/test/listItems.test.js`
- Modify: `web/package.json` (add `"test"` script)
- Create: `web/src/components/ListInput.jsx`

**Interfaces:**
- Consumes: `FIELD` from `web/src/components/common.jsx`.
- Produces:
  - `parseItems(value: string): string[]` — split on `,`, trim, drop empties, drop duplicates keeping the first.
  - `normalizeItem(raw: string, itemType: "text"|"number"|"time"): string|null` — trimmed item, or `null` if invalid for the type.
  - `addItems(items: string[], raw: string, opts?: {itemType?: string, sort?: boolean}): string[]` — `raw` may contain commas (paste); invalid and duplicate entries are ignored.
  - `removeItem(items: string[], item: string): string[]`
  - `joinItems(items: string[]): string`
  - `<ListInput value: string, onChange: (next: string) => void, itemType?: "text"|"number"|"time", sort?: boolean, placeholder?: string, ariaLabel?: string />`

- [ ] **Step 1: Add the web test script**

In `web/package.json`, add to `scripts`: `"test": "node --test \"test/*.test.js\""`.

- [ ] **Step 2: Write the failing test**

Create `web/test/listItems.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseItems, normalizeItem, addItems, removeItem, joinItems } from "../src/lib/listItems.js";

test("parseItems trims, drops empties and duplicates, keeps order", () => {
  assert.deepEqual(parseItems(" a, b,,a ,c "), ["a", "b", "c"]);
  assert.deepEqual(parseItems(""), []);
  assert.deepEqual(parseItems(undefined), []);
});

test("normalizeItem filters by itemType", () => {
  assert.equal(normalizeItem(" host ", "text"), "host");
  assert.equal(normalizeItem("   ", "text"), null);
  assert.equal(normalizeItem("456", "number"), "456");
  assert.equal(normalizeItem("45a", "number"), null);
  assert.equal(normalizeItem("04:00", "time"), "04:00");
  assert.equal(normalizeItem("4:00", "time"), null);
  assert.equal(normalizeItem("24:00", "time"), null);
  assert.equal(normalizeItem("12:60", "time"), null);
});

test("addItems appends in order, ignores duplicates and invalid entries", () => {
  assert.deepEqual(addItems(["b"], "a"), ["b", "a"]);
  assert.deepEqual(addItems(["a"], "a"), ["a"]);
  assert.deepEqual(addItems([], "x"), ["x"]);
  assert.deepEqual(addItems([], "1,x,2", { itemType: "number" }), ["1", "2"]);
});

test("addItems splits pasted comma lists", () => {
  assert.deepEqual(addItems(["a"], "b, c ,a"), ["a", "b", "c"]);
});

test("addItems sorts when asked", () => {
  assert.deepEqual(addItems(["16:00"], "04:00", { itemType: "time", sort: true }), ["04:00", "16:00"]);
});

test("removeItem and joinItems", () => {
  assert.deepEqual(removeItem(["a", "b"], "a"), ["b"]);
  assert.equal(joinItems(["a", "b"]), "a,b");
  assert.equal(joinItems([]), "");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npm test`
Expected: FAIL — cannot find module `../src/lib/listItems.js`.

- [ ] **Step 4: Write the helper**

Create `web/src/lib/listItems.js`:

```js
// Pure logic behind ListInput: a list field is stored as one comma-separated
// string, so everything here converts between that string and an array.

const VALID = {
  text: (s) => s.length > 0,
  number: (s) => /^\d+$/.test(s),
  time: (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s),
};

export function parseItems(value) {
  const seen = new Set();
  for (const part of String(value ?? "").split(",")) {
    const item = part.trim();
    if (item) seen.add(item);
  }
  return [...seen];
}

export function normalizeItem(raw, itemType = "text") {
  const item = String(raw ?? "").trim();
  return (VALID[itemType] || VALID.text)(item) ? item : null;
}

export function addItems(items, raw, { itemType = "text", sort = false } = {}) {
  const next = [...items];
  for (const part of String(raw ?? "").split(",")) {
    const item = normalizeItem(part, itemType);
    if (item && !next.includes(item)) next.push(item);
  }
  return sort ? next.sort() : next;
}

export function removeItem(items, item) {
  return items.filter((i) => i !== item);
}

export function joinItems(items) {
  return items.join(",");
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npm test`
Expected: PASS (6 tests).

- [ ] **Step 6: Write the component**

Create `web/src/components/ListInput.jsx`:

```jsx
import { useState } from "react";
import { FIELD } from "./common.jsx";
import { parseItems, addItems, removeItem, joinItems } from "../lib/listItems.js";

const CHIP =
  "inline-flex items-center gap-1 rounded-lg bg-slate-100 py-1 pl-2.5 pr-1 text-xs font-medium " +
  "text-slate-700 dark:bg-slate-800 dark:text-slate-200";
const SMALL_BUTTON =
  "rounded-lg px-2.5 py-1 text-xs font-medium text-accent-700 hover:bg-slate-100 " +
  "dark:text-accent-400 dark:hover:bg-slate-800";

// Edits one comma-separated string as a row of removable chips. The string
// stays the source of truth (value in, value out), so callers keep their
// existing storage and API shapes.
export default function ListInput({ value, onChange, itemType = "text", sort = false, placeholder, ariaLabel }) {
  const items = parseItems(value);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false); // time mode: entry input is hidden until "+ Add time"
  const opts = { itemType, sort };

  function emit(next) {
    onChange(joinItems(next));
  }

  function commit(raw) {
    emit(addItems(items, raw, opts));
    setDraft("");
    setAdding(false);
  }

  function onKeyDown(e) {
    if (e.key === "Enter" || (e.key === "," && itemType !== "time")) {
      e.preventDefault();
      if (draft) commit(draft);
    } else if (e.key === "Escape") {
      setDraft("");
      setAdding(false);
    } else if (e.key === "Backspace" && !draft && items.length > 0) {
      emit(items.slice(0, -1));
    }
  }

  function onChangeText(e) {
    const text = e.target.value;
    // A paste of "a,b,c" (or a typed comma on a text field) becomes chips at once.
    if (text.includes(",")) commit(text);
    else setDraft(itemType === "number" ? text.replace(/\D/g, "") : text);
  }

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label={ariaLabel} role="group">
      {items.map((item) => (
        <span key={item} className={CHIP}>
          {item}
          <button
            type="button"
            onClick={() => emit(removeItem(items, item))}
            aria-label={`Remove ${item}`}
            className="rounded-md px-1.5 py-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-white"
          >
            ×
          </button>
        </span>
      ))}

      {itemType === "time" ? (
        adding ? (
          <span className="inline-flex items-center gap-1">
            <input
              autoFocus
              type="time"
              className={`${FIELD} !w-auto !py-1`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button type="button" className={SMALL_BUTTON} onClick={() => draft && commit(draft)}>
              Add
            </button>
          </span>
        ) : (
          <button type="button" className={SMALL_BUTTON} onClick={() => setAdding(true)}>
            + Add time
          </button>
        )
      ) : (
        <input
          className={`${FIELD} !w-auto min-w-[10rem] flex-1 !py-1`}
          value={draft}
          inputMode={itemType === "number" ? "numeric" : undefined}
          placeholder={items.length === 0 ? placeholder : "Add…"}
          onChange={onChangeText}
          onKeyDown={onKeyDown}
          onBlur={() => draft && commit(draft)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 7: Verify the web build**

Run: `cd web && npm ci && npm run build`
Expected: Vite build succeeds (component is not yet imported anywhere; this confirms the helper tests and package.json are sound; the component is exercised in Tasks 3 and 4).

- [ ] **Step 8: Commit**

```bash
git add web/package.json web/src/lib/listItems.js web/test/listItems.test.js web/src/components/ListInput.jsx
git commit -m "Add the ListInput chips component and its list helpers

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01La595mnRq7gqG2GomorCNG"
```

---

### Task 3: Render `list` fields in `SchemaForm`

**Files:**
- Modify: `web/src/components/SchemaForm.jsx`

**Interfaces:**
- Consumes: `ListInput` (Task 2) and the `type`, `itemType`, `sort` properties on public fields (Task 1).
- Produces: schema fields with `type: "list"` render as chips.

- [ ] **Step 1: Import the component**

After the `DirectiveEnvEditor` import (line 6) add:

```jsx
import ListInput from "./ListInput.jsx";
```

- [ ] **Step 2: Treat `list` as a multi-control field**

In `FieldInput`, add `field.type === "list" ||` to the `multiControl` expression (so the wrapper is a `<div>` with `sm:col-span-2`, as with the other multi-button controls):

```jsx
  const multiControl =
    field.type === "select" ||
    field.type === "list" ||
    field.type === "errorSlates" ||
```

- [ ] **Step 3: Add the render branch**

In `renderControl`, before the `if (field.type === "checkbox")` branch add:

```jsx
  if (field.type === "list") {
    return (
      <ListInput
        value={value}
        onChange={(next) => onChange(field.key, next)}
        itemType={field.itemType || "text"}
        sort={field.sort}
        ariaLabel={field.label}
      />
    );
  }
```

- [ ] **Step 4: Verify the build**

Run: `cd web && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Verify in the running app**

Run the app per the repo's `docs/development.md`, open a gluetun component form (Stack page), and check, in light and dark mode: existing `networks` value shows as chips; typing a name and pressing Enter adds a chip; pasting `a,b,c` adds three; × removes; Backspace on the empty input removes the last chip; saving round-trips as a comma string (re-open the form). For an instance, confirm "Status codes indicating a block" accepts digits only.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/SchemaForm.jsx
git commit -m "Render list schema fields as chips in SchemaForm

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01La595mnRq7gqG2GomorCNG"
```

---

### Task 4: Watchdog check times use `ListInput`

**Files:**
- Modify: `web/src/pages/Vpn.jsx` (imports; `WatchdogCard` render and `dirty`/Save guard, ~lines 323-362 and 385)
- Modify: `web/src/pages/setup/StepHealthCheck.jsx` (import; lines 138-145)

**Interfaces:**
- Consumes: `ListInput` (Task 2), `parseItems` from `web/src/lib/listItems.js` (Task 2).
- Produces: nothing further.

- [ ] **Step 1: Update `Vpn.jsx`**

Add imports after the `usePolling` import:

```jsx
import ListInput from "../components/ListInput.jsx";
import { parseItems } from "../lib/listItems.js";
```

Replace the check-times `<label>` (the first child of the `grid gap-3 sm:grid-cols-2` div) with:

```jsx
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
            Check times (local)
          </span>
          <ListInput
            value={draft.checkTimes}
            onChange={(next) => setDraft({ ...draft, checkTimes: next })}
            itemType="time"
            sort
            ariaLabel="Check times"
          />
          {noTimes && (
            <span className="text-[11px] text-rose-500">At least one time is required.</span>
          )}
        </div>
```

Immediately after the `dirty` constant add:

```jsx
  const noTimes = parseItems(draft.checkTimes).length === 0;
```

Change the Save button's `disabled` to `disabled={saving || !dirty || noTimes}`.

- [ ] **Step 2: Update `StepHealthCheck.jsx`**

Add after the `ChannelSearchInput` import:

```jsx
import ListInput from "../../components/ListInput.jsx";
```

Replace the `<label className="mt-4 ...">` block (lines 138-145) with a `<div>`/`<span>` wrapper (not a `<label>`, since the control holds several buttons), keeping the explanatory caption text unchanged:

```jsx
          <div className="mt-4 flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Check times (local) — usually twice a day should be enough.
              Pick times that are usually outside of your own viewing hours,
              so the health check doesn't interfere with you watching.
            </span>
            <ListInput value={checkTimes} onChange={setCheckTimes} itemType="time" sort ariaLabel="Check times" />
          </div>
```

- [ ] **Step 3: Verify the build and the helper tests**

Run: `cd web && npm test && npm run build`
Expected: tests PASS, build succeeds.

- [ ] **Step 4: Verify in the running app**

On the VPN page: the card shows stored times as chips (an unsorted stored value like `16:00,04:00` displays in stored order until edited, then sorts); `+ Add time` opens the time input, Enter or Add commits, Escape cancels; adding a duplicate does nothing; removing every chip shows "At least one time is required." and disables Save; Save with two times persists (reload to confirm). Repeat the add/remove checks in the setup wizard's health-check step (the server's 400 on empty values still surfaces through the existing error note). Check light and dark mode.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Vpn.jsx web/src/pages/setup/StepHealthCheck.jsx
git commit -m "Use the chips input for watchdog check times

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01La595mnRq7gqG2GomorCNG"
```

---

## Self-Review

- **Spec coverage:** component (Task 2), `list` type exposure and SchemaForm branch (Tasks 1, 3), every row of the converted-fields table (Task 1), watchdog in both places incl. empty-state hint and Save guard (Task 4), manual verification (Tasks 3, 4). The spec's "commit on Enter or change" for times is tightened to Enter/Add button, called out in Global Constraints; update the spec's time bullet in the same push.
- **Placeholders:** none; all code steps show code.
- **Type consistency:** `parseItems`, `normalizeItem`, `addItems`, `removeItem`, `joinItems`, `ListInput` props (`itemType`, `sort`, `placeholder`, `ariaLabel`) and the public field properties `itemType`/`sort` are used identically across tasks.
- **Known gaps:** gluetun `serverCountries` is also a comma list but is not in the approved spec, so it is not converted. gluetun's acceptance of comma-separated `SERVER_CATEGORIES`/`SERVER_REGIONS` is from memory; confirm against gluetun's wiki before merging Task 1's gluetun changes.
