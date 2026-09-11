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
//
// vpnServiceProvider itself is a "combobox" field (options + optionLabels,
// same shape as an ordinary select, but the frontend renders it as a
// searchable/free-text picker instead of a strict button row — see
// PROVIDER_NOTES below and ProviderCombobox.jsx). optionNotes surfaces a
// one-line gotcha for providers whose real setup differs from what's
// otherwise modeled (a credential quirk, or a required field — like
// wireguardAddresses above — that's only gated on for the one provider
// that forced it in). Providers with no note need nothing beyond the
// ordinary fields.

// gluetun's own identifiers (VPN_SERVICE_PROVIDER values), from its wiki's
// setup/providers/ directory. A provider not in this list still works —
// vpnServiceProvider accepts free text — this only saves the common case
// from having to know gluetun's exact spelling.
const PROVIDER_LABELS = {
  airvpn: "AirVPN",
  custom: "Custom (OpenVPN/WireGuard config file)",
  cyberghost: "CyberGhost",
  expressvpn: "ExpressVPN",
  fastestvpn: "FastestVPN",
  giganews: "Giganews",
  hidemyass: "HideMyAss",
  ipvanish: "IPVanish",
  ivpn: "IVPN",
  mullvad: "Mullvad",
  nordvpn: "NordVPN",
  "perfect privacy": "Perfect Privacy",
  privado: "Privado",
  "private internet access": "Private Internet Access",
  privatevpn: "PrivateVPN",
  protonvpn: "ProtonVPN",
  purevpn: "PureVPN",
  slickvpn: "SlickVPN",
  surfshark: "Surfshark",
  torguard: "TorGuard",
  vpnsecure: "VPNSecure",
  "vpn unlimited": "VPN Unlimited",
  vyprvpn: "VyprVPN",
  windscribe: "Windscribe",
};

const NEEDS_WIREGUARD_ADDRESS =
  "WireGuard needs an interface address from your config — set WIREGUARD_ADDRESSES under Extra environment variables.";

// One-line gotchas for providers whose real setup differs from the ordinary
// wireguard/openvpn fields above. Most providers need no entry here.
const PROVIDER_NOTES = {
  nordvpn: "Uses service credentials from the NordVPN dashboard, not your account login.",
  vpnsecure: "Uses a key passphrase instead of a password — set OPENVPN_KEY_PASSPHRASE under Extra environment variables.",
  custom: "Needs a bind-mounted OpenVPN/WireGuard config file — see gluetun's custom provider docs; most fields here won't apply.",
  airvpn: NEEDS_WIREGUARD_ADDRESS,
  fastestvpn: NEEDS_WIREGUARD_ADDRESS,
  ivpn: NEEDS_WIREGUARD_ADDRESS,
  surfshark: NEEDS_WIREGUARD_ADDRESS,
  windscribe: NEEDS_WIREGUARD_ADDRESS,
};

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
      help: "Comma-separated names of existing Docker networks, e.g. vpnnet,ssbackend. The first one becomes the container's primary network. Defaults to the streamshare network the Suite's own compose file already declares — change this only to also join a stack of your own.",
      group: "Image",
      required: true,
      advanced: true,
      default: "streamshare",
    },
    {
      key: "vpnServiceProvider",
      envVar: "VPN_SERVICE_PROVIDER",
      label: "VPN provider",
      help: "gluetun's identifier for your VPN service. Not listed? Type it anyway — gluetun recognizes more providers than this, and Extra environment variables (below) covers anything the form doesn't model yet.",
      type: "combobox",
      options: Object.keys(PROVIDER_LABELS),
      optionLabels: PROVIDER_LABELS,
      optionNotes: PROVIDER_NOTES,
      group: "VPN",
      required: true,
    },
    {
      key: "vpnType",
      envVar: "VPN_TYPE",
      label: "VPN type",
      type: "select",
      options: ["wireguard", "openvpn"],
      optionLabels: { wireguard: "WireGuard", openvpn: "OpenVPN" },
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
      optionLabels: { on: "On", off: "Off" },
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
