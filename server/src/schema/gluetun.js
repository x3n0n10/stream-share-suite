// The gluetun component: the VPN tunnel every StreamShare instance, Caddy and
// UHF share the network namespace of. Fields mirror what a real deployment
// actually sets — see the blueprint's evidence section for why that matters:
// a schema field for something upstream doesn't recognise is a validation
// error at save time, not a silently-ignored env var.
//
// Two fields are conspicuously absent: FIREWALL_OUTBOUND_SUBNETS and
// HTTP_CONTROL_SERVER_ADDRESS. Both are computed by the reconciler rather than
// asked of the operator — see reconcile/gluetun.js — because both encode
// something the Suite already knows (its own network's subnet; the fixed
// control port it talks to) rather than a real choice.

export const GLUETUN_SCHEMA = {
  kind: "gluetun",
  label: "Gluetun (VPN)",
  fields: [
    {
      key: "image",
      envVar: null,
      label: "Image",
      help: "Any tag on qmcgaw/gluetun. Release channels arrive in a later phase.",
      group: "Image",
      default: "qmcgaw/gluetun:latest",
      advanced: true,
    },
    {
      key: "networks",
      envVar: null,
      label: "Docker networks to join",
      help: "Comma-separated names of existing Docker networks, e.g. nordvpn,ssbackend. The first one becomes the container's primary network.",
      group: "Image",
      required: true,
      advanced: true,
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
      key: "blockMalicious",
      envVar: "BLOCK_MALICIOUS",
      label: "Block malicious domains",
      type: "select",
      options: ["on", "off"],
      default: "on",
      group: "Server selection",
      advanced: true,
    },
  ],
};
