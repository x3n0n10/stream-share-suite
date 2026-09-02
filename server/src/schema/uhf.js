// The UHF server component: scheduled recording for IPTV streams, driven by
// a companion app that tells it which stream URL to record and when. This is
// a third-party project, not something the Suite builds — see
// swapplications/uhf-server-dist for what it does, and images such as
// swapplications/uhf-server or solidpixel/uhf-server-docker for how it's
// packaged. The Suite only runs and configures the container; recording
// schedules live entirely in the companion app talking to it.
//
// Optional, unlike gluetun and postgres: most deployments don't run this at
// all, so it stays out of the plan entirely until switched on under Stack
// (see UHF_ENABLED_SETTING in reconcile/catalog.js), rather than sitting
// there permanently as "not configured".
//
// No networks field, unlike gluetun and postgres: with the VPN on it shares
// gluetun's namespace the same way an instance does, and with it off it joins
// whatever network postgres is on — see reconcile/uhf.js and catalog.js's
// namespaceHost for uhf. A recording made through the same tunnel a stream
// would otherwise be served through is the only setup that behaves
// consistently for a provider that restricts access by IP.

export const UHF_SCHEMA = {
  kind: "uhf",
  label: "UHF Server (DVR)",
  fields: [
    {
      key: "port",
      envVar: "PORT",
      label: "Port",
      help: "What the companion app connects to. With the VPN on this is reached at gluetun's address, the same way an instance is; with it off, at this container's own address.",
      group: "UHF",
      default: "8000",
      required: true,
    },
    {
      key: "password",
      envVar: "PASSWORD",
      label: "Password",
      help: "Required by the companion app to authenticate. Leave blank to run without one — fine on a private network, not otherwise.",
      group: "UHF",
      secret: true,
    },
    {
      key: "image",
      envVar: null,
      label: "Image",
      help: "Any tag of swapplications/uhf-server, or a fork such as solidpixel/uhf-server-docker.",
      group: "Container",
      default: "swapplications/uhf-server:latest",
      advanced: true,
    },
    {
      key: "containerName",
      envVar: null,
      label: "Container name",
      help: "Defaults to the Suite's container prefix followed by uhf (streamshare-suite-uhf unless overridden). Point it at a container you already run and the Suite will adopt that one instead of creating a second.",
      group: "Container",
      advanced: true,
    },
    {
      key: "extraEnv",
      envVar: null,
      label: "Extra environment variables",
      help: "One KEY=VALUE per line, passed straight to the container — for anything not modelled above. Not validated, and a named field above always wins if it sets the same key.",
      type: "textarea",
      group: "Container",
      advanced: true,
    },
  ],
};
