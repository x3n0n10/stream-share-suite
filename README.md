<p align="center"><img src="web/public/logo.svg" alt="" width="96" height="96"></p>

# StreamShare Suite

Run a [StreamShare](https://github.com/x3n0n10/stream-share) stack from one web
UI: its instances, VPN, database and reverse proxy. Create, configure, monitor
and update them without maintaining a compose file by hand.

[StreamShare](https://github.com/x3n0n10/stream-share) shares one IPTV provider
account between many users. The Suite is the operations layer around it. See
[Credits](#credits).

## What it does

- **Monitor:** live status of every instance, active users and streams, watch
  history and a leaderboard.
- **Manage:** configure the VPN (gluetun), PostgreSQL, StreamShare instances and
  an optional Caddy reverse proxy. Review a plan, then apply it.
- **Keep the VPN working:** reconnect automatically when a provider blocks your
  exit IP.
- **Recover and update:** download and restore the database, roll back a
  component's configuration, check for newer image builds.

## Security model

- **Configuration lives in a database,** not environment variables. Edits take
  effect on the next poll, with no restart.
- **Real logins:** server-side sessions, scrypt-hashed passwords, CSRF
  protection, and throttled sign-in.
- **Secrets are write-only.** API keys and VPN credentials are never shown back
  in the UI or the API.

## Get started

```sh
docker compose up -d
```

Then open `http://localhost:3000` and create the admin account. The full
walkthrough is in the [quick start](docs/quick-start.md).

Coming from stream-share-dashboard? See [migrating](docs/migrating-from-dashboard.md).

## Documentation

| Topic | Read this to |
| --- | --- |
| [Quick start](docs/quick-start.md) | Get the Suite running |
| [Configuration](docs/configuration.md) | Set environment variables, data directory, PUID/PGID and networks |
| [Dashboard](docs/dashboard.md) | Find your way around the pages |
| [Setup wizard](docs/setup-wizard.md) | Walk through first-time setup |
| [Stack management](docs/stack-management.md) | Plan and apply changes to the stack |
| [Instances](docs/instances.md) | Add, edit and remove StreamShare instances |
| [Caddy](docs/caddy.md) | Publish instances under a hostname with HTTPS |
| [VPN](docs/vpn.md) | Switch the VPN on or off, and pick a provider |
| [VPN watchdog](docs/vpn-watchdog.md) | Reconnect automatically when the exit IP is blocked |
| [API](docs/api.md) | Script the VPN status, reconnect and health check |
| [Backups and updates](docs/backups-and-updates.md) | Back up, restore, roll back and update |
| [Migrating from dashboard](docs/migrating-from-dashboard.md) | Bring over an existing `stream-share-dashboard` setup |
| [Development](docs/development.md) | Run the tests and the dev servers |

## Licence

See [LICENSE](LICENSE).

## Credits

The Suite deploys and monitors [StreamShare](https://github.com/x3n0n10/stream-share),
maintained by [x3n0n10](https://github.com/x3n0n10). StreamShare is a fork of
[lucasduport/stream-share](https://github.com/lucasduport/stream-share) by
**Lucas Duport**, whose hard work on the original project everything here
builds on. Thank you, Lucas.

---

## Support

If you find StreamShare Suite useful, consider supporting its development:

[![paypal](https://www.paypalobjects.com/en_US/i/btn/btn_donateCC_LG.gif)](https://www.paypal.com/donate/?hosted_button_id=7EL3L7PAWZCVW)
