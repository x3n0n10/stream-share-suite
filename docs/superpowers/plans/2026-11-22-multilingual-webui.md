# Multilingual Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every string the Suite's web UI shows can be shown in English, Dutch, German, French or Spanish, following the browser language with a picker to override.

**Architecture:** `react-i18next` in the web app with one JSON file per language under `web/src/locales/<lang>/translation.json`; English is the source of truth and the fallback. The server keeps its English text and adds `code` + `params` to errors, validation messages, plan reasons/warnings and job log lines; the web app translates those from the same JSON files, falling back to the English the server sent.

**Tech Stack:** React 18, Vite 5, Tailwind, `i18next`, `react-i18next`, `i18next-resources-to-backend`; Express server; `node --test` on both sides.

**Spec:** `docs/superpowers/specs/2026-11-22-multilingual-webui-design.md`

## Global Constraints

- Languages: `en` (source + fallback), `nl`, `de`, `fr`, `es`. No RTL.
- Only `en` is statically imported; other languages load on demand via `resourcesToBackend((lng) => import(\`../locales/${lng}/translation.json\`))`.
- Initial language: `resolveLanguage(localStorage "language" || navigator.language)`, so `nl-BE` → `nl` and unsupported → `en`. A `languageChanged` handler saves the choice to `localStorage` under `"language"`; every `localStorage` access is wrapped in try/catch. No language-detector dependency: the tested `resolveLanguage` is the code that runs.
- Interpolation uses i18next's default `{{name}}` syntax. Plurals use `_one` / `_other` with `count`. Sentences with markup use `<Trans>` with named components.
- Keys are nested by page/area and named after what the text is (`vpn.status.connected`, `common.save`), never after the English wording.
- Server text shape: every English field keeps its type and gains a sibling `<field>I18n: { code, params }` object (`reasonI18n`, `errorI18n`, `warningsI18n` as a parallel array). Exceptions where the object is new anyway or the spec fixes it: API error bodies carry top-level `code`/`params` next to `error`, and job log entries are `{ at, line, code?, params? }`.
- Server error/log codes are snake_case (`username_too_short`). The existing `shares_unsupported` code stays unchanged.
- Web namespaces for server text: `errors.<code>` (API errors and `job.error`), `validation.<code>`, `log.<code>` (job log lines), `plan.reason.<code>`, `plan.warning.<code>`, `schema.<kind>.…`, `catalog.<kind>.…`.
- The server keeps sending its English `error` / `message` / `reason` / `line`; `code` and `params` are additive. `code` is not documented in `docs/api.md`.
- Params holding user data or external text (container names, image tags, instance names, messages from Docker, gluetun, instances or providers) are passed through untranslated. A message built from another message translates only the outer one; the inner one is a param.
- Server/console logging, `docs/`, the README and StreamShare's own UI stay English.
- `Intl` formatters are cached per (constructor, language, preset name) in a module-level `Map`; option presets are module constants. All date/time formatting goes through the cache, never `toLocale*`.
- No private names, URLs, IPs or credentials in code, tests, fixtures or commits (repo is public). Example values use `example.com`, "Provider 1", "Channel X".

## Review Focus

1. **Browser language unsupported or regional (`pt-BR`, `nl-BE`)**: `pt-BR` shows English, `nl-BE` shows Dutch, and the language picker shows the language in use. Tested in Task 1 (`detects regional and unsupported languages`).
2. **A non-English file is missing a key or has a stale one**: missing keys show English, never the raw key. A key English doesn't have fails CI. Tested in Task 1 (`locales.test.js`) and Task 2 (`serverText falls back to the server's English`).
3. **Server sends an error with no `code` (old route, or a relayed instance error)**: the English message is shown as it is. Tested in Task 2 (`errorText without code`).
4. **Saved watchdog result written before this change (log is an array of strings)**: the VPN page still renders it. Tested in Task 4 (`renders legacy string log entries`).
5. **A placeholder dropped or renamed in a translation (`{{name}}` → `{{naam}}`)**: CI fails before it ships. Tested in Task 1 (`placeholders match English`).

---

### Task 1: i18n foundation, language picker, guard test, CI

**Files:**
- Modify: `web/package.json` (deps: `i18next`, `react-i18next`, `i18next-resources-to-backend`)
- Create: `web/src/locales/languages.js`
- Create: `web/src/locales/{en,nl,de,fr,es}/translation.json` (`en` holds `common.*` and `language.*` keys; others `{}` for now)
- Create: `web/src/lib/i18n.js`
- Create: `web/src/components/LanguagePicker.jsx`
- Modify: `web/src/main.jsx` (import `./lib/i18n.js` before `App`; wrap `App` in `<Suspense fallback={null}>`)
- Modify: `web/src/components/Layout.jsx:245` (picker next to the theme toggle), `web/src/pages/SignIn.jsx`, `web/src/pages/Setup.jsx` (picker in the header area)
- Create: `web/test/locales.test.js`
- Modify: `.github/workflows/ci.yml` (`web` job: add `- run: npm test` with `working-directory: web` after `npm ci`)
- Create: `.vscode/settings.json` (`"i18n-ally.localesPaths": ["web/src/locales"]`, `"i18n-ally.keystyle": "nested"`, `"i18n-ally.pathMatcher": "{locale}/translation.json"`, `"i18n-ally.sourceLanguage": "en"`)
- Modify: `docs/development.md` (new "Translations" section: file location, key naming, editing on GitHub or with i18n Ally, adding a language = new folder + one entry in `languages.js`)

**Interfaces:**
- Produces: `LANGUAGES: Array<{ code: string, name: string }>` from `web/src/locales/languages.js`, in this order: `en` "English", `nl` "Nederlands", `de` "Deutsch", `fr` "Français", `es` "Español".
- Produces: `resolveLanguage(browserLanguage: string): string` exported from `languages.js`. It returns the supported base language, else `"en"`. `i18n.js` uses it for the initial `lng`.
- Produces: `checkLocales(en, other, { requireAll = false } = {}): string[]` exported from `languages.js` (pure, takes parsed objects). It returns problems: keys `other` has that `en` lacks, placeholder sets that differ, `<Trans>` tags not in English, and, with `requireAll`, keys `en` has that `other` lacks.
- Produces: default export `i18n` from `web/src/lib/i18n.js`. On `languageChanged` it sets `document.documentElement.lang` and saves to `localStorage`.
- Produces: `<LanguagePicker />` (no props). A `<select>` with `aria-label={t("language.label")}`, each option labelled with its own `name`, calling `i18n.changeLanguage(code)`.
- Every later task uses `useTranslation()` → `t` and adds keys to `web/src/locales/en/translation.json`.

- [ ] **Step 1: Write the failing tests in `web/test/locales.test.js`**

The tests read the JSON files with `fs`. They import nothing from i18next.

```js
test("locale files pass checkLocales", () => {     // JSON.parse each non-English file; checkLocales(en, it) → []
});
test("checkLocales catches each kind of problem", () => {
  // en { a: "x {{n}}", t: "<b>y</b>" } vs { a: "y {{m}}", t: "<i>y</i>", z: "q" } → 3 problems
  // with { requireAll: true } and other = {} → 2 problems (a, t missing)
});
test("detects regional and unsupported languages", () => {
  assert.equal(resolveLanguage("nl-BE"), "nl");
  assert.equal(resolveLanguage("de"), "de");
  assert.equal(resolveLanguage("pt-BR"), "en");
  assert.equal(resolveLanguage(""), "en");
});
```

- [ ] **Step 2: Run them, expect FAIL** (`cd web && npm test`; `languages.js` missing).
- [ ] **Step 3: Install the deps** (`cd web && npm install i18next react-i18next i18next-resources-to-backend`). Create `languages.js`, the five locale files, and `i18n.js` per Global Constraints (`fallbackLng: "en"`, `resources: { en: { translation: en } }`, `partialBundledLanguages: true`, `interpolation: { escapeValue: false }`).
- [ ] **Step 4: Run the tests, expect PASS** (`cd web && npm test`).
- [ ] **Step 5: Add `LanguagePicker` to `Layout.jsx`, `SignIn.jsx` and `Setup.jsx`.** Add `.vscode/settings.json`, the CI step and the docs section.
- [ ] **Step 6: Build and smoke-check.** Run `cd web && npm run build`. Expected: the build succeeds, and `dist/assets` has separate chunks for `nl`/`de`/`fr`/`es` (filenames containing `translation`).
- [ ] **Step 7: Commit.** `feat(web): i18n foundation with language picker and locale guard test`

---

### Task 2: Formatting and server-text helpers

**Files:**
- Modify: `web/src/lib/format.js`
- Create: `web/src/lib/serverText.js`
- Test: `web/test/format.test.js`, `web/test/serverText.test.js`

**Interfaces:**
- Consumes: `i18n` (Task 1) only through an explicit `lng` argument. Pure modules must not import `i18n.js`, so `node --test` can load them.
- Produces, in `format.js`, the existing functions gaining a trailing `lng = "en"` argument:
  - `formatDuration(totalSeconds, lng)`
  - `formatRelativeTime(isoString, { withTime, lng })`
  - `formatDate` / `formatDateTime(..., lng)`
  - Callers pass `i18n.language`.
  - No `t` parameter: `Intl.RelativeTimeFormat(lng, { numeric: "auto" })` already gives "now" / "nu" / "jetzt", and "—" is the same in every language.
- Produces, in `serverText.js`:
  - `serverText(t, ns, item, fallback)`. `item` is `{ code?, params? }` or undefined: an API error body, a log entry, or a `<field>I18n` object. Returns `item?.code ? … : fallback`, i.e. `item.code ? t(\`${ns}.${item.code}\`, { ...item.params, defaultValue: fallback }) : fallback`.
  - `errorText(err, t)`. Also used by the existing `describeFailures` in `web/src/lib/applyToAll.js`, whose "Failed on …" text becomes a key. For an `ApiError`, returns the joined translated `err.body.errors[]` when present: each via `serverText(t, "validation", e, e.message)`, with `field` param = `t(\`schema.${kind}.fields.${e.key}.label\`, { defaultValue: e.key })` when `err.body.kind` is set. Otherwise returns `serverText(t, "errors", err.body, err.message)`. For a plain `Error`, returns `err.message`.
  - `jobLine(t, entry)`. `entry` is a string (legacy saved result) or `{ line, code?, params? }`. Returns `serverText(t, "log", entry, entry.line ?? entry)`.

- [ ] **Step 1: Write the failing tests.**

```js
// format.test.js
test("formatDuration is localized", () => {
  assert.equal(formatDuration(3900, "en"), "1h 5m");   // keep today's English output
  assert.notEqual(formatDuration(3900, "de"), formatDuration(3900, "en")); // only if Intl.DurationFormat exists; else skip
});
test("formatRelativeTime uses the given language")   // 2 days ago: "en" contains "2 days", "nl" contains "2 dagen"

// serverText.test.js — fake t = (key, opts) => dict[key] ? interpolate(dict[key], opts) : opts.defaultValue
test("serverText translates a known code with params")      // { code: "username_too_short", params: { min: 3 } } → "Gebruikersnaam … 3 …"
test("serverText falls back to the server's English")        // unknown code → fallback
test("errorText without code")                               // ApiError("Boom", 502, { error: "Boom" }) → "Boom"
test("errorText joins translated validation errors")         // body.errors = [{ key: "displayName", code: "required", message: "Name is required." }], body.kind = "instance" → uses schema.instance.fields.displayName.label
test("jobLine handles legacy strings")                       // jobLine(t, "Pulled image") → "Pulled image"
```

- [ ] **Step 2: Run them, expect FAIL** (`cd web && npm test`).
- [ ] **Step 3: Implement.** `formatDuration` uses `Intl.DurationFormat(lng, { style: "narrow" })` when it exists. Otherwise it keeps today's `h`/`m`/`s` output. `formatRelativeTime` passes `lng` to the existing `Intl.RelativeTimeFormat`. One `getFormatter(Ctor, lng, preset)` caches by `` `${Ctor.name}|${lng}|${preset}` ``, with presets as module-constant option objects. The date functions use `getFormatter(Intl.DateTimeFormat, …).format(date)` instead of `toLocale*`.
- [ ] **Step 4: Update every caller** of the format functions to pass the active language (`grep -rn "formatDuration\|formatRelativeTime\|formatDate" web/src`). Replace the 6 copies of `err.body?.errors?.map((e) => e.message).join(" ") || err.message` with `errorText(err, t)`: `setup/StepVpn.jsx:37`, `setup/StepDatabase.jsx:22`, `setup/StepInstances.jsx:171,188`, `stack/InstancesTab.jsx:217,231`, and the 7th inside `describeFailures` (`lib/applyToAll.js:11`). `describeFailures` gains a `t` argument; update its callers and `web/test` if it is tested.
- [ ] **Step 5: Run the tests and the build, expect PASS** (`cd web && npm test && npm run build`).
- [ ] **Step 6: Commit.** `feat(web): localized formatting and server-text helpers`

---

### Task 3: Server error codes

**Files:**
- Create: `server/src/errors.js`
- Modify: `server/src/auth/passwords.js` (`validatePassword`), `server/src/routes/settings.js` (`validateUrl`, `validateName`, and the other validators), `server/src/schema/registry.js` (`validate`)
- Modify: every `res.status(...).json({ error ... })` site: `app.js` (1), `auth/middleware.js` (3), `routes/auth.js` (8), `routes/backup.js` (5), `routes/ops.js` (16, including `failure()`), `routes/settings.js` (12), `routes/stack.js` (25), `routes/watchdog.js` (1)
- Modify: `server/src/routes/stack.js:251-260` and the instance/component PUT routes. A 400 carrying validation `errors` also sends `kind`.
- Test: `server/test/errors.test.js`. Also update the assertions in the existing `auth.test.js`, `registry.test.js` and `stack-routes.test.js` that compare error strings.

**Interfaces:**
- Produces, in `server/src/errors.js`:
  - `class SuiteError extends Error { constructor(code, message, params = {}, status) }`. The one type for Suite-made messages: validators return one (not thrown), and code that fails throws one. Sets `.code`, `.params`, `.status`.
  - `sendError(res, status, err, extra = {})`. `err` is a `SuiteError`, or any `Error`/string from outside the Suite. Responds `{ error: message, code?, params?, ...extra }`, leaving out `code`/`params` when `err` has no `.code`. `extra` carries `errors` and `kind` for validation responses.
  - `failure()` in `routes/ops.js:62` and the matching code at `routes/stack.js:88` keep their status rule: a downstream 401/403 becomes 502, because any 401 from the Suite logs the UI out. Only their final `.json(...)` becomes `sendError(res, computedStatus, err)`.
- Changes: `validatePassword(password)` returns `new SuiteError("password_too_short", "Password must be at least 12 characters.", { min: 12 })`, `new SuiteError("password_too_long", …, { max: 200 })`, or `null`. `validateName(value, label)` returns `new SuiteError("required", \`${label} is required.\`, { field: label })` etc. The `required` code is shared with `registry.js`.
- Changes: each error from `registry.validate()` gains `code`: `"required"`, `"not_one_of"` (`params: { options }`), `"invalid"`, `"invalid_json"`. A field's own `patternMessage` gets `code: "pattern"`. The web app looks up `schema.<kind>.fields.<key>.patternMessage` for it.
- Web consumers (Task 2's `errorText`) read `err.body.code`, `err.body.params`, `err.body.errors[].code`, `err.body.kind`.

- [ ] **Step 1: Write the failing tests in `server/test/errors.test.js`.**

```js
test("sendError sends code and params for a SuiteError")   // fake res → body { error: "Password must…", code: "password_too_short", params: { min: 12 } }
test("sendError leaves out code for an outside error")     // new Error("ECONNREFUSED") → { error: "ECONNREFUSED" } with no code key
test("validatePassword returns codes")                    // "short" → code password_too_short
test("registry.validate tags required errors")             // missing displayName → { key: "displayName", code: "required", message: "Name is required." }
test("no route sends a raw error body", () => {
  // scan server/src/**/*.js: no match for /\.json\(\{\s*error\s*:/ outside errors.js
});
```

- [ ] **Step 2: Run them, expect FAIL** (`cd server && npm test`).
- [ ] **Step 3: Implement `errors.js`. Convert the validators and `registry.validate`.** Each validation error item stays a plain `{ key, message, code, params? }` object, since it is data in a list and not thrown. Then replace every raw error response with `sendError`. Give each literal message a code at the site where it's made. A relayed message (`err.message` from an instance, Docker or gluetun client) goes through unchanged with no code. A message wrapped around one (`settings.js:109` "Gluetun …") becomes `new SuiteError("gluetun_error", …, { detail: err.message })`. `ops.js` `shares_unsupported` keeps its code.
- [ ] **Step 4: Run the whole server suite, expect PASS** (`cd server && npm test`). Fix the existing tests that compared error bodies. Their English `error` text must stay identical.
- [ ] **Step 5: Commit.** `feat(server): error codes alongside English error messages`

---

### Task 4: Job log, plan reason and warning codes

**Files:**
- Modify: `server/src/reconcile/jobs.js` (`appendLog`, `finishJob`)
- Modify: the log callbacks in `server/src/routes/stack.js:111,114` and `server/src/watchdog/scheduler.js:73,76`, and `jobResult` (`scheduler.js:34`)
- Modify: the `log(...)` calls in `reconcile/reconciler.js` (28), `reconcile/database.js` (8), `reconcile/provisioning.js` (5), `reconcile/cacheFolder.js` (2), `watchdog/vpnWatchdog.js` (12)
- Modify: plan `reason` and `warnings` in `reconcile/reconciler.js` and `reconcile/graph.js`
- Modify: `web/src/pages/stack/PlanPanel.jsx:99-156` and `web/src/pages/Vpn.jsx:415-417`. Render through `jobLine`, `serverText(t, "plan.reason", row.reasonI18n, row.reason)`, `serverText(t, "plan.warning", row.warningsI18n?.[i], w)` and `serverText(t, "errors", job.errorI18n, job.error)`.
- Test: `server/test/jobs-codes.test.js`, additions to `reconciler.test.js` and `vpnWatchdog.test.js`, and `web/test/serverText.test.js`

**Interfaces:**
- Consumes: `SuiteError` (Task 3), `serverText` and `jobLine` (Task 2)
- Produces: `appendLog(job, line, { code, params } = {})`. Stores `{ at, line, code?, params? }`.
- Produces: `finishJob(job, error)`. Also sets `job.errorI18n = { code, params }` when `error.code` is set.
- Produces: the step log callback signature `log(line, { code, params } = {})`. Every caller of `appendLog` forwards the second argument.
- Produces: `jobResult(job).log` becomes `job.log.map(({ line, code, params }) => ({ line, code, params }))`, and it also returns `errorI18n`. Old saved results keep string arrays, and `jobLine` handles both.
- Produces: each plan gains `reasonI18n: { code, params }`. `warnings` stays an array of strings; plans gain a parallel `warningsI18n: Array<{ code, params }>`.

- [ ] **Step 1: Write the failing tests.**

```js
// server/test/jobs-codes.test.js
test("appendLog stores code and params")      // appendLog(job, "Pulled x", { code: "image_pulled", params: { image: "x" } }) → job.log[0] has them
test("finishJob keeps a SuiteError's code")    // finishJob(job, new SuiteError("port_clash", "…", { port: 9000 })) → job.errorI18n.code === "port_clash"
test("jobResult keeps codes")                  // jobResult(job).log[0].code === "image_pulled"
// reconciler.test.js
test("create plan carries a reason code")      // action "create" → reasonI18n { code: "not_created_yet", params.name === spec.name }
// vpnWatchdog.test.js
test("watchdog log lines carry codes")         // the existing fake log collects (line, extra); the "nothing to watch" path → code "no_health_checks"
// web/test/serverText.test.js
test("renders legacy string log entries")      // jobLine(t, "Reconnect attempt 1/3...") → same string
```

- [ ] **Step 2: Run them, expect FAIL** (`cd server && npm test`; `cd web && npm test`).
- [ ] **Step 3: Implement `jobs.js`, the callbacks and `jobResult`.** Then give every `log(...)`, `reason` and warning a code and params. Use the same codes as Task 3 where the meaning matches. Instance names, container names, image tags and `err.message` go in as params.
- [ ] **Step 4: Update `PlanPanel.jsx` and `Vpn.jsx` to render through the helpers.** Add the English keys under `log.*`, `plan.reason.*`, `plan.warning.*` and `errors.*` in `en/translation.json`. Copy the English wording exactly, with `{{param}}` placeholders.
- [ ] **Step 5: Run both suites and the build, expect PASS.**
- [ ] **Step 6: Commit.** `feat: codes for job log lines, plan reasons and warnings`

---

### Task 5: Schema and catalog text from translation keys

**Files:**
- Modify: `web/src/components/SchemaForm.jsx`. New required prop `kind: string`. Lines 99 (group), 173-178 (help), 203/245 (label), 295 (option labels).
- Modify: every `<SchemaForm` call site, passing its kind: `setup/StepVpn.jsx:83` (`gluetun`), `setup/StepDatabase.jsx:39` (`postgres`), `setup/StepInstances.jsx:241` (`instance`), `stack/GluetunCard.jsx:85`, `stack/CaddyCard.jsx:90`, `stack/PostgresCard.jsx:67`, `stack/InstancesTab.jsx:334,377`
- Modify: `stack/GluetunCard.jsx:54`, `CaddyCard.jsx:59`, `PostgresCard.jsx:44` (descriptions), and wherever the catalog `label` is shown
- Modify: `web/src/locales/en/translation.json`. Add `schema.*` and `catalog.*` with the English copied from `server/src/schema/*.js` and `server/src/reconcile/catalog.js`.
- Test: `server/test/i18n-coverage.test.js`

**Interfaces:**
- Consumes: `t`
- Produces: the key shape. Labels: `schema.<kind>.label`, `schema.<kind>.fields.<fieldKey>.label`, `.help`, `.patternMessage`, `.options.<value>`. Groups: `schema.<kind>.groups.<groupSlug>`. Catalog: `catalog.<kind>.label` and `catalog.<kind>.description`. `groupSlug` is the group name lower-camel-cased (`"DNS challenge"` → `dnsChallenge`). It comes from one exported `groupSlug(name)` in `web/src/lib/schemaKeys.js` (no imports), which the server coverage test imports by relative path. Rewording a group on the server changes its key, and the coverage test then fails until `en` is re-keyed. That's accepted: groups are rarely reworded, and `en` is where wording is edited.
- Every lookup passes the server's English as `defaultValue`. A user-entered instance `displayName` shown as a catalog label is never translated.

- [ ] **Step 1: Write the failing test `server/test/i18n-coverage.test.js`.** It imports the five schemas, reads the catalog entries' `kind`/`label`/`description` (import `catalog.js`, which already loads in other server tests), and reads `../../web/src/locales/en/translation.json`.

```js
test("en has a label for every schema field")          // and help / patternMessage / each option label when the field has them
test("en has every schema group")
test("en has every catalog label and description")
```

- [ ] **Step 2: Run it, expect FAIL** (`cd server && npm test`).
- [ ] **Step 3: Add the keys to `en/translation.json`** (a one-off Node script in the scratchpad is fine for generating them, but don't commit the script). Make `SchemaForm` and the cards look them up.
- [ ] **Step 4: Run both suites and the build, expect PASS.**
- [ ] **Step 5: Commit.** `feat(web): schema and catalog text from translation keys`

---

### Tasks 6–9: Extract UI strings

The same steps apply to each batch. Every visible string goes through `t()` or `<Trans>`: text nodes, `placeholder`, `title`, `aria-label`, `alt`, button labels, confirm-dialog text, `submitLabel` props, empty states, toasts. Every caught error shown to the user goes through `errorText(err, t)`. Keys live under the page's own namespace. Shared words go under `common.*`.

**Verification command for every batch** (run from `web`). It lists JSX text nodes still holding letters and should print nothing for the batch's files:

```bash
node -e 'const fs=require("fs");for(const f of process.argv.slice(1)){const s=fs.readFileSync(f,"utf8").replace(/\{[^{}]*\}/g," ");for(const m of s.matchAll(/>([^<>]*[A-Za-z]{2,}[^<>]*)</g)){const t=m[1].trim();if(t&&!/[=;(]/.test(t))console.log(f+": "+t)}}' <files>
```

Also grep the batch for `placeholder="`, `title="`, `aria-label="` and `label="` holding letters.

Steps for each batch:
- [ ] Extract the strings in the batch's files. Add the English keys.
- [ ] Run the verification command and the grep: nothing left except brand names (Gluetun, Caddy, PostgreSQL, StreamShare, Xtream, M3U), which stay as they are.
- [ ] `cd web && npm test && npm run build` passes.
- [ ] Commit `feat(web): translatable strings — <batch>`.

**Task 6, shell and shared components:** `App.jsx`, `components/*.jsx` (all 15), `pages/SignIn.jsx`
**Task 7, setup wizard:** `pages/Setup.jsx`, `pages/setup/*.jsx` (10)
**Task 8, Stack:** `pages/Stack.jsx`, `pages/stack/*.jsx` (9)
**Task 9, remaining pages:** `Overview`, `Instances`, `Aliases`, `History`, `Leaderboard`, `Settings`, `Users`, `Vod`, `Vpn`, `ShareLinks`, `shareLinks/NewShareDialog`, plus `lib/ActiveStreamsContext.jsx` and `lib/ConfigContext.jsx` if they hold user-visible text

---

### Task 10: Translations and visual check

**Files:**
- Modify: `web/src/locales/{nl,de,fr,es}/translation.json`

- [ ] **Step 1: Translate every key in `en/translation.json` into nl, de, fr and es.**
  - Keep every `{{placeholder}}` and `<Trans>` tag.
  - Keep brand names.
  - Use the informal register common in each language's software UIs: Dutch "je", German "du", Spanish "tú", French "vous".
  - Keep each string about as short as English where possible: buttons, badges and tabs.
- [ ] **Step 2: Run `cd web && npm test`, expect PASS.** Also confirm no non-English file is missing keys: `node -e` calling `checkLocales(en, x, { requireAll: true })` for each language prints nothing.
- [ ] **Step 3: Run the app** (use the `run` skill). In German, the longest language, screenshot Overview, Stack (components, plan panel), setup wizard steps, Settings and the VPN page at desktop and 390 px widths. Fix any overflow (buttons, badges, tabs, table headers) with wrapping or `truncate` plus `title`, not by shortening the meaning.
- [ ] **Step 4: Switch through all five languages with the picker.** Expected: the text changes without a reload, `<html lang>` follows, and the choice survives a reload. Clear `localStorage` with the browser set to `nl-BE`: Dutch shows.
- [ ] **Step 5: Commit.** `feat(web): Dutch, German, French and Spanish translations`
