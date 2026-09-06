# Setup wizard idempotency & editing

## Context

The redesigned Setup wizard (see
`2026-09-05-setup-wizard-redesign-design.md` and its implementation plan)
only knows how to create things. `Setup.jsx`'s `instances` state starts as
`useState([])` — every run assumes nothing exists yet. Re-running the
wizard after the first time can only add more instances; it has no way to
show, let alone edit, anything already configured. `StepVpn` and the Caddy
half of `StepExternalAccess` ask their yes/no question fresh every time
regardless of the actual stored `vpnEnabled`/`caddyEnabled` state.

This spec makes the wizard idempotent: reachable at any time, always
showing the stack's actual current configuration, editable in place. It
supersedes that earlier spec's explicit "editing after setup already works
via Stack" scoping decision — the wizard is now meant to be the primary way
to review and adjust configuration going forward, not a first-run-only
guide.

## Scope

**In scope**: every step seeds itself from real stored values instead of
starting blank, and lets the operator edit what's already there. Adding a
new instance still works exactly as today.

**Out of scope, deliberately**: the wizard does not take over anything
Stack already owns — plan review, apply, job logs, container import,
component history/rollback. It also does not add instance removal; that
stays a Stack-only action (its drop-database confirmation is a more
consequential flow than this spec's editing-focused scope warrants). No
"skip a fully-configured step" logic — every run always walks all seven
steps in order, pre-filled where there's something to pre-fill. This is a
deliberate simplification: a per-step "is this done" rule would need its
own definition per step and could guess wrong; always showing every step is
simpler to build and impossible to get confusingly wrong.

## Setup.jsx: seed instances on mount

`instances` changes from `useState([])` to being populated from
`api.stackInstances()` on mount (the same call Stack's own instance list
already uses), storing `{ key, port, displayName }` per existing instance —
identical shape to what `StepInstances`'s add-flow already produces for a
freshly created one, so every downstream step keeps working against one
consistent list regardless of which instances are old and which are new
this session.

The "at least one instance" gate on `StepInstances`'s Continue button now
naturally reflects this seeded count — no separate change needed there.

## StepInstances: existing list + collapsed add-form

Existing instances render as a list above the add-instance control: each
row shows `displayName`, `xtreamBaseUrl`, and a human label for the current
access mode, with an "Edit" toggle. Clicking Edit fetches
`api.componentFields("instance", key)` and renders the existing generic
`SchemaForm` against it — exactly the same fetch-then-`SchemaForm` pattern
`Stack.jsx`'s `InstancesCard` already uses for editing an instance, reused
as-is rather than reinvented. Unlike the add-flow's hand-built 3-way access
chooser (which exists specifically to spare a first-time setup from
retyping credentials), editing an existing instance uses the schema's own
`authMode` field directly (`basic`/`ldap`) — a stored instance already has
a concrete value there, so the "reuse provider creds" shortcut has nothing
to add.

"Add another instance" changes from an always-open form to a collapsed
`+ Add another instance` button (this spec's chosen layout) that reveals
the current add-flow (Provider fields + 3-way access chooser) when clicked
— unchanged in its own behavior, just no longer competing visually with the
existing list by default.

No remove control is added here — removing an instance stays a Stack-only
action.

## StepCaching: per-instance instead of shared

The shared "one toggle + one path for every instance" model is replaced
with a per-instance list, matching the shape `StepExternalAccess` and
`StepHealthCheck` already have. On entering this step, fetch
`api.componentFields("instance", key)` for every instance in the list and
seed each one's VOD-cache toggle, catchup toggle (+ duration), and cache
path from its actual stored values.

The "type one parent folder, get a suggested `<parent>/<key>` subfolder per
instance" convenience is kept, but now scoped by whether an instance
already has a `cachePath` value, not by whether the instance itself is new
this session: an instance with an existing path always shows and edits
that value directly, untouched by the shared-parent-path suggestion
mechanism; an instance with no path yet — whether it's brand new this
session or an existing instance having caching turned on for the first
time — still gets the suggestion. Submitting patches every instance whose
caching state or path actually changed via `api.updateStackInstance`, same
`Promise.allSettled` + `describeFailures` pattern already in use.

## StepExternalAccess

**Part A** (per-instance public URL + Discord): on entering the step, fetch
each instance's current `publicBaseUrl`, `discordEnabled`, whether a bot
token is already set, and `discordAdminRoleId`, and seed the per-instance
form state from them instead of `blankAccess()`. An instance with a bot
token already stored shows the existing write-only convention — "A token is
set. Leave blank to keep it, or type a new one to replace it." — the same
wording `Settings.jsx`'s instance API-key field and `SchemaForm`'s own
secret-field handling already use, not a new pattern.

**Part B** (Caddy): restructured from "ask yes/no, then show the form on a
second screen" into one screen — a toggle seeded from the actual
`caddyEnabled` stack setting, with the Caddy `SchemaForm` (still filtered
to the `HTTPS` group) appearing inline beneath it when the toggle is on.
Unlike the old two-screen version, this also gives an operator a way to
turn Caddy back off from the same screen, which the previous one-directional
flow had no path back to.

## StepVpn: same toggle+inline-form restructuring

Today's `StepVpn` is a one-shot yes/no screen that, once answered, replaces
itself with the gluetun form with no way back — there is no way to
re-answer "no" once you've said "yes," and re-entering the step after VPN
is already on always tries to show the yes/no question again rather than
the current state. This spec folds it into the same shape as the Caddy
restructuring above: one screen, a toggle seeded from the actual
`vpnEnabled` stack setting, with the gluetun `SchemaForm` appearing inline
beneath it when the toggle is on. Turning the toggle off saves
`vpnEnabled: false` immediately, same as today's "No" path; turning it on
reveals the form, seeded with current gluetun values via
`api.componentFields("gluetun")` when already configured.

## StepHealthCheck: seed from real state

The multi-select of instances is seeded by checking each instance's actual
`healthCheckEnabled` rather than starting fully unselected. Every
already-enabled instance's Stream ID input is pre-filled from its stored
`healthCheckStreamId`. The check-times field is seeded from
`api.watchdogSettings()`'s actual `checkTimes` value instead of the
hardcoded `"04:00,16:00"` default (that value only applies now when no
watchdog settings have ever been saved). This step is still reached only
when `StepVpn` calls `onNext("health")` — that routing decision is
unchanged. What changes is that `StepVpn`'s own toggle is now seeded from
the real `vpnEnabled` value rather than defaulting to unanswered, so an
operator who already has VPN on reaches this step on every run, not only
the run where they first turned it on.

## StepDatabase: unchanged

Already round-trips through `SchemaForm` against `api.componentFields
("postgres")`'s real current values — re-running the wizard already shows
and lets you edit the actual stored configuration here. Nothing in this
spec changes this step.

## Out of scope (deliberately)

- Instance removal — stays on Stack.
- Plan review, apply, job logs, container import, component
  history/rollback — all stay on Stack; this wizard is configuration only.
- Skipping a step because it looks "already done" — every run always shows
  every step.
- Any change to `StepDatabase`.
