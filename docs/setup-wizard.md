# Setup wizard

The wizard walks you through a fresh install. It starts with your instances and
then covers the infrastructure they need. A signed-in user with no instances
lands here automatically. You can open it any time from the sidebar.

Steps, in order:

1. **Port range:** the band instance ports are allocated from.
2. **Instances:** one card per provider. Choose Xtream API or an M3U playlist,
   how users sign in (including "use my provider credentials"), and the name and
   address.
3. **Features:** VOD caching and live catchup buffering, with a cache location
   per instance.
4. **Database:** PostgreSQL run by the Suite, or an external server.
5. **External access:** Caddy for a public hostname, and the Discord bot.
6. **VPN:** gluetun on or off, with a searchable provider picker.
7. **Health check:** a probe channel per instance for the
   [VPN watchdog](vpn-watchdog.md), picked by searching channel names. Skipped
   when the VPN is off.
8. **Done:** hands off to the [Stack page](stack-management.md)'s plan.

Every step starts from what the server already has, so re-running the wizard
edits existing settings rather than creating new ones. The wizard saves through
the same API as the rest of the Suite. Leaving partway through is fine: finish
from the Stack page instead. Nothing is created in Docker while you are still in
the wizard.
