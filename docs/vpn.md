# VPN

All traffic from the Suite's instances goes through one tunnel, managed by
gluetun. The VPN is a single stack-wide setting, not a per-instance one. Every
StreamShare deployment shares one tunnel. Per-instance tunnels would mean a
gluetun container each.

## Turning it off and on

**Off:** gluetun leaves the stack. Its card stays on the Stack page, but it no
longer appears in any plan as something to act on. A running container is handled
by who created it. A container the Suite created becomes an orphan, which you can
remove when you are ready. A container you created yourself is reported as
switched off and left alone. Either way it keeps running and stays on the page.

**On:** gluetun returns with its configuration intact. The toggle also changes
how every other component is addressed, so the plan shows the whole stack
recreating when you flip it.

## Other VPN providers

The gluetun form covers the common fields: provider, WireGuard or OpenVPN, and
server selection. Those cover most of gluetun's ~40 supported providers. Two need
extra fields that appear once you pick them. Mullvad needs an explicit
`WIREGUARD_ADDRESSES`. Private Internet Access identifies servers by region, not
country.

For anything not modelled yet, use **Extra environment variables** under
Advanced. It passes raw `KEY=VALUE` lines straight to the container. Those lines
are not validated like the named fields. A named field always wins if both set the
same key, so the extra box can fill gaps but cannot override a validated setting.

## The VPN page

The **VPN** page talks to the Suite's own gluetun container, using the control-server
API key the Suite generated for it. gluetun rejects every request without that key.
The key is created the first time the gluetun form is saved with real values, and
it stays the same afterwards.

If you run a gluetun that the Suite did not create, set `GLUETUN_URL` and
`GLUETUN_API_KEY`. The VPN page shows a message when neither is available. If the
VPN page shows no connection after an upgrade, open the gluetun card on the Stack
page and click Save once. This creates the key.

For the automatic reconnect that keeps your exit IP usable, see the
[VPN watchdog](vpn-watchdog.md).
