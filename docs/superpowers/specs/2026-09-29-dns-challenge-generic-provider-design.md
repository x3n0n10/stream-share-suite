# Fully generic DNS-challenge provider — design

## Goal

Remove the Hetzner/Cloudflare preset picker from Caddy's DNS-challenge mode. The operator always enters the Caddy module and the directive directly; the Suite auto-detects which `{env.NAME}` credentials that directive references and renders one write-only box per name, instead of one free-text KEY=VALUE textarea.

## Context

PR #46 (this branch) added the preset table. It has not merged, so nothing depends on `dnsProvider`/`dnsApiToken` existing — this replaces them outright, no migration path needed.

Also fixed on this branch, and unaffected by this change: `caddy add-package` keys its package registry on a module's base path (confirmed live against `caddyserver.com/api/packages`), not necessarily the real go.mod `/v2`-suffixed path, and without an explicit `@version` it can build a module's unreleased branch HEAD rather than its newest tag — this is what broke Hetzner in a real deployment even though its newest tag was already current. Every module value from here on must be pinned to a specific `@version`.

## Design

### Schema (`server/src/schema/caddy.js`)

Remove the `dnsProvider` (select) and `dnsApiToken` (secret) fields entirely.

`dnsModule` and `dnsDirective` stay, but lose their `dnsProvider: "custom"` condition — both are now visible whenever `tlsMode === "dns"`, nothing else. Their help text gains 2-3 copy-pasteable examples (module + directive pairs for Hetzner and Cloudflare, pinned to a version) and repeats the "pin an exact version" rule already added to the module field's help in the previous change on this branch.

`dnsEnv` keeps its key and its storage shape (a secret string of `KEY=VALUE` lines, parsed with the existing `parseExtraEnv`) but changes `type` to a new value, `"directiveEnv"`, rendered by a new editor component instead of a plain textarea.

`dnsPropagationDelay` is unchanged.

### The env editor

New component `web/src/components/DirectiveEnvEditor.jsx`, the same shape as the existing `ErrorSlateEditor.jsx`: a structured editor over one field's string value. Given the live directive text and the field's current raw value, it:

1. Finds every `{env.NAME}` occurrence in the directive (regex `/\{env\.([A-Za-z0-9_]+)\}/g`), in order, deduplicated.
2. Renders one labelled, write-only text input per name (same visual treatment as any other secret field — blank by default, "Set. Leave blank to keep it." / "Not set." per the existing convention, at the level of the individual box: each box's own placeholder reflects whether that name currently has a stored value, read by parsing the incoming raw text once on mount/prop-change).
3. On any keystroke, serializes only the currently-referenced names back into `KEY=VALUE\n` text and calls `onChange`. A name removed from the directive drops out of the UI and out of the next saved value — never a lingering unreferenced credential.
4. Renders nothing (a small note instead) when the directive references no `{env.*}` names yet.

`SchemaForm.jsx` needs one generic addition: `renderControl` (and `FieldInput`) gain the whole `draft` object as a parameter, passed alongside the field's own `value`, so a field's custom component can read a sibling field (here, `dnsDirective`). Every existing field type ignores the extra parameter; this is the same plumbing shape `componentKey` already gets for `channelSearch`. `dnsEnv`'s new type is added to the two existing "full width" checks (`sm:col-span-2` in the grid, and the `multiControl` set that renders a `<div>` wrapper instead of a `<label>`), the same treatment `errorSlates` already has.

### Backend (`server/src/reconcile/caddy.js`)

`dnsChallenge(values)` collapses to one path, no provider branching:

```js
export function dnsChallenge(values) {
  if (values.tlsMode !== "dns") return null;

  const module = String(values.dnsModule || "").trim();
  if (!MODULE_PATH.test(module)) return null;

  const directive = String(values.dnsDirective || "").replace(/\s*\n\s*/g, " ").trim();
  if (!directive) return null;

  const env = parseExtraEnv(values.dnsEnv);
  const delay = String(values.dnsPropagationDelay || "").trim();
  return { directive, env, modules: [module], propagationDelay: GO_DURATION.test(delay) ? delay : null };
}
```

`renderCaddyfile` and `renderCaddySpec` are untouched — they already only consume `dnsChallenge()`'s return shape, which is unchanged (`directive`, `env`, `modules`, `propagationDelay`).

### Completeness (`server/src/reconcile/catalog.js`'s `ready` hook)

Replaces the current custom-provider-only checks with, for any DNS mode:

```js
ready: (values) => {
  if (values.tlsMode !== "dns") return null;
  if (!String(values.dnsDirective || "").trim()) return "DNS challenge needs a directive.";
  if (!MODULE_PATH.test(String(values.dnsModule || "").trim())) {
    return "DNS challenge needs a Caddy module such as github.com/caddy-dns/porkbun@v1.2.3.";
  }
  const referenced = [...String(values.dnsDirective || "").matchAll(/\{env\.([A-Za-z0-9_]+)\}/g)].map((m) => m[1]);
  const provided = new Set(Object.keys(parseExtraEnv(values.dnsEnv)));
  const missing = [...new Set(referenced)].filter((name) => !provided.has(name));
  if (missing.length > 0) return `Directive references ${missing.join(", ")} but no value is set.`;
  return null;
},
```

This is the one place the detection regex is duplicated (frontend editor, backend `ready`) rather than shared — both are small, self-contained, and this file already duplicates comparable small parsing logic rather than reaching for a module shared across the client/server boundary.

### `server/src/schema/dnsProviders.js`

`DNS_PROVIDERS` and its two entries are deleted; the file keeps only `MODULE_PATH` and its comment. Renamed to `server/src/schema/dnsModule.js` (the "providers" name no longer describes its contents). Every import of `DNS_PROVIDERS` or `MODULE_PATH` from the old path is updated to the new one.

### Docs

README's DNS-challenge paragraphs are rewritten: no more "Hetzner and Cloudflare are built in", replaced by "enter the module and directive for any provider" plus the same copy-paste examples as the field help, and the existing pinning guidance kept as is.

## Testing

`server/test/caddy.test.js`'s DNS-mode section is substantially rewritten:

- `dnsChallenge`: directive with zero, one, and two `{env.*}` references; missing/invalid module; blank directive; propagation delay behaviour unchanged from today.
- `renderCaddyfile`/`renderCaddySpec`: unchanged assertions still hold (they exercise `dnsChallenge`'s output shape, not its internals) — kept, values simplified to module+directive instead of provider+token.
- `ready`: blank directive, invalid module, a directive referencing a name `dnsEnv` doesn't supply (single and multiple missing), and the previously-passing "everything present" case.
- Removed: every test keyed on `dnsProvider`, the Hetzner/Cloudflare table lookups, and `dnsApiToken`.

`DirectiveEnvEditor.jsx` gets no automated test — `web/` has no test framework, consistent with every other Caddy UI change on this branch. Manual/browser verification only.

## Out of scope

- Any preset or picker UI.
- A shared client/server module for the `{env.NAME}` detection regex.
- Automated frontend tests (no framework exists to add them to).
