# README refresh

## Problem

`README.md` was last touched 2026-09-06. It still frames the Suite as
"being built in phases" and describes a three-step Setup wizard and a
single-scroll Stack page. About 40 commits since then added features it never
mentions, and it has neither the logo nor a donate link like the sister
project's README.

## Changes

All in `README.md`. No code, no new assets.

1. **Logo.** `<p align="center"><img src="web/public/logo.svg" ...></p>` at the
   top, same markup as stream-share's README. `web/public/logo.svg` is
   byte-identical to stream-share's `assets/logo.svg`, so it is referenced in
   place rather than copied.
2. **Intro.** Drop the "built in phases" framing. Say what the Suite is, link
   [x3n0n10/stream-share](https://github.com/x3n0n10/stream-share) as the
   project it deploys and monitors. Retitle "What works today (phase 0)" so it
   reads as the security/config model, not a status.
3. **Dashboard section.** One short list of the pages: Overview, Users,
   History, Leaderboard, Instances, VOD search, Aliases, VPN, Setup wizard,
   Stack, Settings. Note that pages with nothing to show are hidden until an
   instance exists (or the VPN is on), and the sidebar collapses to icons.
4. **Missing features**, each verified against code before writing:
   - Instance provider: Xtream API or M3U playlist (`providerType`).
   - Sign-in per instance: username/password or LDAP, plus the "use provider
     credentials" shortcut and its post-setup reset.
   - Discord bot per instance.
   - Caching: VOD cache, live catchup buffer, per-instance cache path.
   - Error slates: on/off, custom messages per status code or connection
     failure, retry window.
   - Health-check probe channel picker (search by name).
   - Searchable VPN provider picker on the gluetun form.
   - Apply pulls the image when the `image` value itself changed.
5. **Rewrite Setup wizard section** to the real flow: port range, instances,
   features, database, external access (Caddy and Discord), VPN, health check
   (skipped with the VPN off), done. Existing config is prefilled and editable.
6. **Rewrite Stack layout paragraph**: tabs (Instances, Components, Import)
   beside a persistent, resizable plan panel.
7. **Links.** Bare "stream-share" mentions that name the project become links.
8. **Credits** (before Support): stream-share is a fork of
   [lucasduport/stream-share](https://github.com/lucasduport/stream-share) by
   Lucas Duport, with thanks. stream-share's own upstream chain stays in its
   own README.
9. **Support.** Trailing `---` + `## Support` + PayPal donate badge, copied from
   stream-share's README.

## Out of scope

Rewriting accurate long-form sections (Stack management, PUID/PGID, data and
backups, VPN watchdog). Any code change.

## Verification

Every added claim traced to a file in `server/src/schema/`, `web/src/pages/`
or `web/src/components/`. Render check: logo path resolves, all links well
formed, PayPal URL matches stream-share's.
