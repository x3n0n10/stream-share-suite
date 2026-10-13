# README compression: design

## Goal

The README is 788 lines and reads as a wall to someone deciding whether to try
the Suite. Shrink it to a landing page that says what the Suite is, how to get it
running, and where to find everything else. Move the help content into focused
pages under `docs/`.

## Decisions

- **README** keeps: the pitch, a feature summary, the security model in three
  bullets, the quick start (short), the environment variables, a table of links
  to the help pages, licence, credits and support.
- **Help pages** under `docs/` hold everything a user needs once the Suite is
  running, one topic per page. The quick start is the first of them.
- **Dropped entirely:** the phase plan and every "from phase Nx" note. That is
  project history, not help. Internal architecture references that point at
  non-existent notes are removed too.
- **Migration** from stream-share-dashboard gets its own page, linked from the
  quick start, since only people with an existing stack need it.
- **Unchanged:** `docs/superpowers/` (agent specs and plans) is not touched.

## Page map

| Page | Covers |
| --- | --- |
| `README.md` | Landing: pitch, features, security model, links |
| `docs/quick-start.md` | Compose up, pick a tag, create the admin, first steps |
| `docs/migrating-from-dashboard.md` | Importing `INSTANCE_N_*` / `GLUETUN_*` variables |
| `docs/configuration.md` | Environment variables, PUID/PGID, data directory, networks |
| `docs/dashboard.md` | What each page in the sidebar does |
| `docs/setup-wizard.md` | The guided first-time setup |
| `docs/stack-management.md` | Stack page, plan outcomes, adopt and import, orphans |
| `docs/instances.md` | Creating, editing and removing instances; their settings |
| `docs/caddy.md` | Reverse proxy, HTTPS modes, DNS challenge |
| `docs/vpn.md` | VPN toggle, other providers |
| `docs/vpn-watchdog.md` | Automatic reconnect when a provider blocks the exit IP |
| `docs/api.md` | Bearer-token routes for scripts |
| `docs/backups-and-updates.md` | Backup and restore, component history, release channels |
| `docs/development.md` | Running tests and the dev servers |

## Writing rules

- Each help page opens with one sentence saying what it is for.
- Config tables stay in `configuration.md`; other pages link to them.
- No duplicated explanations: the bind-mount rule lives in `configuration.md`
  only, and other pages link to it.
- Plain language first; the reasoning behind a decision stays only where it
  changes what the user does.

## Verification

- Every relative link in the README and `docs/` resolves to an existing file.
- Every environment variable in the old README still appears in
  `configuration.md`.
- Every API route in the old README still appears in `api.md`.
