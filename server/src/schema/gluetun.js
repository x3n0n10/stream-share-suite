// The gluetun component: the VPN tunnel every StreamShare instance shares
// the network namespace of. Fields mirror what a real deployment actually
// sets — see the blueprint's evidence section for why that matters:
// a schema field for something upstream doesn't recognise is a validation
// error at save time, not a silently-ignored env var.
//
// Two fields are conspicuously absent: FIREWALL_OUTBOUND_SUBNETS and
// HTTP_CONTROL_SERVER_ADDRESS. Both are computed by the reconciler rather than
// asked of the operator — see reconcile/gluetun.js — because both encode
// something the Suite already knows (its own network's subnet; the fixed
// control port it talks to) rather than a real choice.
//
// gluetun supports around 40 providers, and a handful need fields beyond the
// common wireguard/openvpn pair below (Mullvad requires an explicit interface
// address; PIA identifies servers by region rather than country). Those are
// modeled as ordinary fields gated by dependsOn on vpnServiceProvider — see
// wireguardAddresses and serverRegions — rather than one schema per provider.
// Anything not modeled yet has an escape hatch: extraEnv passes raw
// KEY=VALUE lines straight to the container, unvalidated, so an unlisted
// provider is never blocked on us adding it as data.

export const GLUETUN_SCHEMA = {
  kind: "gluetun",
  label: "Gluetun (VPN)",
  fields: [
    {
      key: "image",
      envVar: null,
      label: "Image",
      help: "Any tag on qmcgaw/gluetun. Use \"Check for updates\" on this card to pull it and recreate only if it actually changed.",
      group: "Image",
      default: "qmcgaw/gluetun:latest",
      advanced: true,
    },
    {
      key: "containerName",
      envVar: null,
      label: "Container name",
      help: "Defaults to the Suite's container prefix followed by gluetun (streamshare-suite-gluetun unless overridden). Point it at a container you already run and the Suite will adopt that one instead of creating a second.",
      group: "Image",
      advanced: true,
    },
    {
      key: "networks",
      envVar: null,
      label: "Docker networks to join",
      help: "Comma-separated names of existing Docker networks, e.g. nordvpn,ssbackend. The first one becomes the container's primary network. Defaults to the streamshare network the Suite's own compose file already declares — change this only to also join a stack of your own.",
      group: "Image",
      required: true,
      advanced: true,
      default: "streamshare",
    },
    {
      key: "vpnServiceProvider",
      envVar: "VPN_SERVICE_PROVIDER",
      label: "VPN provider",
      help: "gluetun's provider identifier, e.g. nordvpn, mullvad, protonvpn.",
      group: "VPN",
      required: true,
    },
    {
      key: "vpnType",
      envVar: "VPN_TYPE",
      label: "VPN type",
      type: "select",
      options: ["wireguard", "openvpn"],
      default: "wireguard",
      group: "VPN",
      required: true,
    },
    {
      key: "wireguardPrivateKey",
      envVar: "WIREGUARD_PRIVATE_KEY",
      label: "WireGuard private key",
      group: "VPN",
      secret: true,
      required: true,
      dependsOn: { key: "vpnType", equals: "wireguard" },
    },
    {
      key: "openvpnUser",
      envVar: "OPENVPN_USER",
      label: "OpenVPN username",
      group: "VPN",
      required: true,
      dependsOn: { key: "vpnType", equals: "openvpn" },
    },
    {
      key: "openvpnPassword",
      envVar: "OPENVPN_PASSWORD",
      label: "OpenVPN password",
      group: "VPN",
      secret: true,
      required: true,
      dependsOn: { key: "vpnType", equals: "openvpn" },
    },
    {
      key: "wireguardAddresses",
      envVar: "WIREGUARD_ADDRESSES",
      label: "WireGuard interface address",
      help: "Required for Mullvad: the CIDR address from Mullvad's own config generator — the same for every Mullvad server and tied to your private key. Most other WireGuard providers derive this on their own and don't need it set.",
      group: "VPN",
      required: true,
      dependsOn: [
        { key: "vpnType", equals: "wireguard" },
        { key: "vpnServiceProvider", oneOf: ["mullvad"] },
      ],
    },
    {
      key: "serverCountries",
      envVar: "SERVER_COUNTRIES",
      label: "Server countries",
      help: "e.g. Netherlands. Leave blank to let the provider pick.",
      group: "Server selection",
      advanced: true,
    },
    {
      key: "serverCategories",
      envVar: "SERVER_CATEGORIES",
      label: "Server categories",
      help: "e.g. P2P. Provider-specific — leave blank if yours doesn't use categories.",
      group: "Server selection",
      advanced: true,
    },
    {
      key: "serverHostnames",
      envVar: "SERVER_HOSTNAMES",
      label: "Preferred server hostnames",
      help: "Comma-separated. This is the list a VPN healer would cycle through in a later phase.",
      group: "Server selection",
      advanced: true,
    },
    {
      key: "serverRegions",
      envVar: "SERVER_REGIONS",
      label: "Server regions",
      help: "Private Internet Access identifies servers by region rather than country, e.g. us_east. Leave blank to let PIA pick.",
      group: "Server selection",
      advanced: true,
      dependsOn: { key: "vpnServiceProvider", oneOf: ["private internet access"] },
    },
    {
      key: "blockMalicious",
      envVar: "BLOCK_MALICIOUS",
      label: "Block malicious domains",
      type: "select",
      options: ["on", "off"],
      default: "on",
      group: "Server selection",
      advanced: true,
    },
    {
      key: "extraEnv",
      envVar: null,
      label: "Extra environment variables",
      help: "One KEY=VALUE per line, passed straight to the container. For a provider whose fields aren't modeled above yet — not validated, and a named field above always wins if it sets the same key.",
      type: "textarea",
      group: "Advanced",
      advanced: true,
    },
  ],
};
