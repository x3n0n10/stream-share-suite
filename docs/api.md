# API

Scripts and other tools can read the VPN status, trigger a reconnect, and run the
watchdog's health check, without signing in.

## Create a token

Go to **Settings → API access** and generate a token. It is shown once. Only its
hash is stored.

- Generating again replaces the old token.
- **Revoke** disables the token.
- Changing the admin password also disables it.

## Use the token

Send it as a bearer token:

```sh
# VPN status and exit IP
curl -H "Authorization: Bearer $TOKEN" https://suite.example/api/gluetun

# Reconnect: stop, wait, start, wait. Blocks until the VPN is running again
# (up to the reconnect timeout, 45 s by default), so allow at least 60 s.
curl -X POST -m 60 -H "Authorization: Bearer $TOKEN" https://suite.example/api/gluetun/reconnect

# Health check: probes every watched instance and, if any report their provider
# is blocking the current exit IP, reconnects gluetun and retries (up to the
# configured max reconnects). Blocks until done. At the defaults that can take
# several minutes, so allow at least 300 s.
curl -X POST -m 300 -H "Authorization: Bearer $TOKEN" https://suite.example/api/watchdog/health-check

# Same result shape, without starting a run: the last run's outcome.
curl -H "Authorization: Bearer $TOKEN" https://suite.example/api/watchdog/health-check
```

Reconnect and health check are independent. Triggering one never triggers the
other. To check a fresh exit IP straight away, call `/gluetun/reconnect`, then
`/watchdog/health-check`.

## Limits

The token only works on these routes for now. Any other route returns `403`. A
wrong token returns `401`.

Failed token attempts count toward the failed sign-in limit. A client that keeps
sending a wrong token gets throttled (`429`), and that also delays sign-in for up
to 15 minutes.

For what the health check does, see the [VPN watchdog](vpn-watchdog.md).
