# Multilingual web UI — design

## Intent

The Suite should be usable by a wide audience, including people who are not
comfortable with English. Every piece of text the web UI shows should be
available in the user's language.

A second benefit the maintainer wants: once all UI text lives in translation
files, descriptions, help texts and labels can be edited (in English too)
without touching code.

## Goals

- Every string the web UI shows can be translated: page text, labels,
  placeholders, titles, `aria-label`s, confirm dialogs, and the server-provided
  text the UI renders (schema field labels and help, component catalog
  descriptions, API error messages, validation messages, plan reasons, job log
  lines).
- English plus four starter languages: Dutch (`nl`), German (`de`), French
  (`fr`), Spanish (`es`). Translations are written by Claude and reviewed by the
  maintainer as they see fit.
- The language follows the browser by default; a picker in the UI overrides it.
- A missing translation falls back to English. The UI never shows a raw key or
  breaks.
- Dates, times and durations are formatted for the active language.
- Translations are plain JSON files in the repo, editable on GitHub or in
  VS Code with the i18n Ally extension.

## Non-goals

- Server/console logging stays English.
- `docs/` and the README stay English.
- The StreamShare app's own UI (the Go repo) is out of scope.
- Right-to-left languages (Arabic, Hebrew, …) are out of scope for now.
- No hosted translation platform (Weblate, Crowdin, …).
- No in-app translation editor.
- Text coming from outside the Suite is not translated: messages relayed from
  StreamShare instances, gluetun, Docker, or the provider are shown as they are.
- User-entered data (instance names, aliases, share-link labels) is never
  translated.

## Anti-goals

- Translations that break the UI: lost `{{placeholders}}`, invalid JSON, or
  layouts that overflow badly with longer German/French text.
- Breaking API clients. The public API (`docs/api.md`) keeps returning its
  English `error` strings; translation support is additive.
- A second set of translation files on the server that has to be kept in sync
  with the web app.

## Constraints

- Web: React 18 + Vite, plain JSX, Tailwind. Tests run with `node --test`
  (`web/test/*.test.js`). No i18n library today; `index.html` hard-codes
  `lang="en"`.
- Server: Express, plain JS. Server-generated UI text today lives in:
  - `server/src/schema/*.js`: `label`, `help`, `optionLabels`, `group`,
    `patternMessage` per field (~75 fields), plus the schema `label`.
  - `server/src/reconcile/catalog.js`: component labels and descriptions.
  - `server/src/schema/registry.js`: validation messages built from field
    labels (`"${field.label} is required."`).
  - `server/src/reconcile/reconciler.js` and `graph.js`: plan `reason` strings
    and job `log(...)` lines (~28), shown in the Stack page's PlanPanel.
  - `server/src/routes/*.js`, `server/src/auth/passwords.js`: ~70 `{ error }`
    responses, surfaced by `web/src/lib/api.js` through `ApiError.message`.
- Rough size: 600–900 strings in 49 `.jsx` files, plus the server-side strings
  above.

## Approaches considered

**A. `react-i18next` in the web app; the server sends keys (picked).**
The web app loads one JSON file per language and renders text with `t()`.
The server keeps sending English but adds stable keys/codes alongside, and the
web app translates them from the same JSON files. One set of translations.
Cost: the `i18next`, `react-i18next` and `i18next-browser-languagedetector`
dependencies (~40 KB).

**B. Same split, with a home-made `t()` helper.** No dependency, but sentences
with embedded links or markup, plurals, detection and fallback all become
custom code to write and test.

**C. The server translates its own strings** based on the request language.
Two translation sets to keep in sync, plus per-request language handling on the
server, for the same end result.

The maintainer picked **A**: it handles the hard cases (markup inside
sentences, plurals) without custom code, and the server change stays small and
backward compatible.

## Design

### Translation files

- `web/src/locales/<lang>/translation.json` for `en`, `nl`, `de`, `fr`, `es`.
- English is the source and the fallback (`fallbackLng: "en"`).
- Keys are nested by page or area and named after what the text is, not the
  English wording: `vpn.status.connected`, `stack.plan.applyButton`,
  `common.save`. Shared words (Save, Cancel, Delete, …) live under `common`.
- Only `en` is statically imported, since it is the fallback and must be
  there synchronously. Other languages load on demand through i18next's
  `resourcesToBackend` with a dynamic `import()`, so Vite splits each into
  its own chunk. At ~1,000 keys a language is roughly 70 KB, so bundling all
  five would about double the current JS download.
- Plurals use i18next's `_one` / `_other` suffixes (with `count`), backed by
  `Intl.PluralRules`.
- Sentences with links or emphasis use `<Trans>` with named components, so
  translators can reorder the sentence.

### Language selection

- `i18next-browser-languagedetector`, order: `localStorage` then `navigator`.
- Unsupported browser languages fall back to English; regional variants map to
  the base language (`nl-BE` → `nl`).
- The detector stores the choice itself (`caches: ["localStorage"]`), like
  the existing theme toggle does in `web/src/lib/useTheme.js`. No separate
  storage code. It is per browser, not per user
  account, so it also works on the login and first-run setup screens.
- A language picker sits next to the theme toggle in `Layout.jsx`, and on the
  login/setup screens. Each language shows its own name ("Nederlands",
  "Deutsch", …).
- `document.documentElement.lang` is updated when the language changes.

### Formatting

- `web/src/lib/format.js` already uses `Intl.RelativeTimeFormat` and
  `toLocale*`, but hard-codes `"en"` / `undefined`. Pass the active language
  instead, and translate the remaining literals ("just now", "—").
- `formatDuration` uses
  `Intl.DurationFormat` (`style: "narrow"`), so it needs no translation keys.
- Any other `toLocale*` calls get the active language passed in.
- `Intl` formatters are cached per (language, options) in a module-level map,
  not built per call. Lists and job logs format many rows per render.

### Server-provided text

The server keeps its English text. It adds keys the web app can translate.
If the web app has no translation for a key, it shows the English text the
server sent. That keeps API clients and older UIs working.

**Source of truth for UI text is `en/translation.json`**, including the
server-provided labels, help texts, option labels, groups, catalog
descriptions and messages. The maintainer edits wording there, without
touching code. The English left in server code is only what API clients
see and the fallback for a missing key. The two copies may drift apart
after an edit. That is accepted, and nothing keeps them identical.
The guard test checks that `en/translation.json` has a key for every schema
field (label, plus help/options/groups where present) and every catalog
entry, so nothing silently falls back to the server's copy.

**Scope is every server string the UI shows**, not only the ones listed under
Constraints. That includes `log(...)` lines from all reconcile steps
(`provisioning.js`, `database.js`, `cacheFolder.js`, …), the VPN watchdog's
job lines and its saved last result, plan `warnings`, `job.error` for errors
the Suite throws itself. For a message built from another message, only the
outer message is translated. The inner one is passed as a param, in the same
way as relayed external text. Watchdog results saved before this change have no
`code` and show in English. That is accepted.

- **Schema fields and catalog components.** No server change needed: keys are
  derived on the web side from data the server already sends:
  `schema.<kind>.fields.<fieldKey>.label`, `.help`, `.options.<value>`,
  `.patternMessage`, `schema.<kind>.groups.<group>`, and
  `catalog.<kind>.label` / `.description`. `SchemaForm` and the Stack page
  look the key up with the English text as `defaultValue`.
- **API errors.** Responses become `{ error: "<English>", code: "<key>",
  params: { … } }`. The web app looks up `errors.<code>`. Codes
  follow the snake_case style already in use: `ops.js` sends
  `code: "shares_unsupported"`, which `ShareLinks.jsx` checks. That code stays
  as it is, and new ones look like `username_too_short`. The code is attached where the
  message is made, not at each route: shared validators (`auth/passwords.js`,
  the checks in `routes/settings.js`, `registry.js`) and anything the Suite
  throws return `{ message, code, params }`. One server helper turns that into
  the JSON response, so a route can't send an error without its code. The
  same rule uses the same code everywhere: `settings.js`'s "X is required."
  reuses `validation.required`. `ApiError` needs no change: it already
  keeps `.message` (English) and the whole payload in `.body`, so the UI reads
  `err.body.code` / `err.body.params`. `code` is for the web UI only. It is not
  documented in `docs/api.md` and may be renamed freely (builder's call). One helper (`errorText(err, t)`) gives the UI
  `t("errors." + code, { ...params, defaultValue: err.message })`. It also
  handles validation lists in `err.body.errors`, replacing the idiom
  `err.body?.errors?.map((e) => e.message).join(" ") || err.message`, which is
  copied in `StepVpn.jsx`, `StepDatabase.jsx`, `StepInstances.jsx` (twice) and
  `InstancesTab.jsx` (twice). Every page that shows `err.message` today
  switches to that helper.
- **Validation messages** (`registry.js`): each error gets a `code` (e.g.
  `validation.required`). It already carries the field `key`, and the web app
  knows which schema kind the form is for. So the web app translates the field
  name through the schema key above, so "Name is
  required." becomes "Naam is verplicht."
- **Plan reasons and job log lines:** the same `code` + `params` pattern next
  to the existing English `reason` / log text. All job log lines already
  go through `appendLog(job, line)` in `server/src/reconcile/jobs.js`, which
  stores `{ at, line }`, and `job.error` is set only in `finishJob`. Both are
  extended once (`appendLog(job, line, { code, params })`, and the same for
  `finishJob`). The `log` callback passed to each step forwards the extra
  argument, so every step gets it for free. Params that hold user data or
  external text (container names, image tags, messages relayed from Docker or
  instances) are passed through untranslated.

### Guard rails

A `web/test/locales.test.js` that fails the build when:

- a locale file is not valid JSON;
- a non-English locale has keys that English does not (a typo'd or stale key);
- a translation's set of `{{placeholders}}` differs from the English one;
- a `<Trans>` component tag in a translation does not appear in English.

Missing keys in a non-English locale are allowed, since they fall back to
English. The CI `web` job (`.github/workflows/ci.yml`)
only builds today; it gets an `npm test` step so these checks (and the existing
web tests) actually run.

### Editing workflow

- Edit `translation.json` on GitHub, or in VS Code with i18n Ally (a
  `.vscode/settings.json` in the repo points the extension at
  `web/src/locales` with the `nested` key style).
- `docs/development.md` gets a short "Translations" section: where the files
  are, how keys are named, how to add a language (add a folder and register
  it in one list in `web/src/lib/i18n.js`).

## Left to the builder

- Exact key names and grouping per page, within the conventions above.
- Order of extraction (page by page is fine; English fallback means a
  half-done page still works).
- Fixing layouts where longer translations overflow (buttons, badges, tabs).
