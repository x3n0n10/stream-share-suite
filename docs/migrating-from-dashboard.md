# Migrating from stream-share-dashboard

If you already run `stream-share-dashboard`, you can bring its settings across
instead of re-entering them.

## Import your existing variables

Paste your existing `INSTANCE_N_*` and `GLUETUN_*` variables into the compose
file for the first boot. The Suite imports them into its database once, then
ignores them.

After the import, the database is the source of truth. A variable you left
behind cannot silently override an edit you made in the UI. Delete the variables
once the startup log says the import has run.

## What carries over

Everything the dashboard did still works:

- overview
- history and leaderboard
- active users and streams
- IP aliases
- VOD search and download
- VPN status and reconnect, through gluetun's control server

Next, see the [quick start](quick-start.md#3-set-up-your-first-instance) to
check the imported settings.
