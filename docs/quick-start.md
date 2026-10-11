# Quick start

This gets the Suite running on one Docker host, then points it at your first
StreamShare instance. You need Docker with the compose plugin.

## 1. Start it

```sh
docker compose up -d
```

Compose pulls the published image, `ghcr.io/x3n0n10/stream-share-suite:latest`
(amd64 and arm64).

To stay on one release line instead of following `latest`, pin the tag in the
compose file:

- `:1.0.0` for one exact release
- `:1.0` for patch updates only
- `:1` for any 1.x release

To build from source instead, uncomment the `build: .` line in the compose file.

## 2. Create the admin account

Open `http://localhost:3000` and create the admin account. Nothing else in the
app answers until that account exists.

## 3. Set up your first instance

The [setup wizard](setup-wizard.md) walks you through the rest: your port range,
your first provider, storage, the database, and optional VPN and public access.
It only saves settings. Nothing is created in Docker until you apply the plan on
the [Stack page](stack-management.md).

## Next steps

- Check the [configuration](configuration.md) page if you run on Unraid, need a
  different data path, or want the Suite on a specific network.
- [Back up](backups-and-updates.md#backups) `suite.db` once your settings are in.
  It holds every credential the Suite has.
- Migrating from `stream-share-dashboard`? Follow
  [migrating from the dashboard](migrating-from-dashboard.md) first.
