// A StreamShare instance: one IPTV provider account, shared with several
// users. This is the first kind of which there can be many, so unlike gluetun
// and postgres its components carry a key.
//
// stream-share reads roughly fifty environment variables. Modelling all of
// them would be a worse form than modelling the dozen that decide whether it
// runs at all, so the rest go through extraEnv — the same escape hatch the
// gluetun schema uses for its long tail of providers.
//
// Several values are conspicuously absent because the Suite computes them
// rather than asking (see reconcile/instance.js):
//
//   PORT                  allocated from a band, so two instances cannot clash
//   INTERNAL_API_KEY      generated, so an instance is reachable by the
//                         dashboard the moment it exists and nobody types a key
//   DB_*                  derived from the postgres component plus this
//                         instance's own generated database and role
//   INSTANCE_NAME         the display name below
//   CACHE_FOLDER          fixed at the mount point of the cache volume
//   HEALTHCHECK_TIMES,
//   HEALTHCHECK_MIN_INTERVAL_SECONDS  fixed to "off" / a short throttle when
//                         health checking is on — the VPN watchdog's own
//                         schedule decides when to probe, not the instance's

export const INSTANCE_SCHEMA = {
  kind: "instance",
  label: "StreamShare instance",
  fields: [
    {
      key: "displayName",
      envVar: null,
      label: "Name",
      help: "How this provider appears in the dashboard, e.g. \"Provider 1\".",
      group: "Instance",
      required: true,
    },

    // --- provider -----------------------------------------------------------
    {
      key: "xtreamBaseUrl",
      envVar: "XTREAM_BASE_URL",
      label: "Xtream base URL",
      help: "Your provider's portal address, e.g. http://provider.example:8080",
      group: "Provider",
      required: true,
    },
    {
      key: "xtreamUser",
      envVar: "XTREAM_USER",
      label: "Xtream username",
      group: "Provider",
      required: true,
    },
    {
      key: "xtreamPassword",
      envVar: "XTREAM_PASSWORD",
      label: "Xtream password",
      group: "Provider",
      secret: true,
      required: true,
    },
    {
      key: "m3uUrl",
      envVar: "M3U_URL",
      label: "M3U URL",
      help: "Only needed if your provider serves a playlist separately from its Xtream API.",
      group: "Provider",
      advanced: true,
    },

    // --- who may use it -----------------------------------------------------
    {
      key: "authMode",
      envVar: null,
      label: "How users sign in",
      type: "select",
      options: ["basic", "ldap"],
      default: "basic",
      group: "Access",
      required: true,
    },
    {
      key: "authUser",
      envVar: "AUTH_USER",
      label: "Username",
      group: "Access",
      required: true,
      dependsOn: { key: "authMode", equals: "basic" },
    },
    {
      key: "authPassword",
      envVar: "AUTH_PASSWORD",
      label: "Password",
      group: "Access",
      secret: true,
      required: true,
      dependsOn: { key: "authMode", equals: "basic" },
    },
    {
      key: "ldapServer",
      envVar: "LDAP_SERVER",
      label: "LDAP server",
      help: "e.g. ldap://ldap.example:389",
      group: "Access",
      required: true,
      dependsOn: { key: "authMode", equals: "ldap" },
    },
    {
      key: "ldapBaseDn",
      envVar: "LDAP_BASE_DN",
      label: "Base DN",
      group: "Access",
      required: true,
      dependsOn: { key: "authMode", equals: "ldap" },
    },
    {
      key: "ldapBindDn",
      envVar: "LDAP_BIND_DN",
      label: "Bind DN",
      group: "Access",
      required: true,
      dependsOn: { key: "authMode", equals: "ldap" },
    },
    {
      key: "ldapBindPassword",
      envVar: "LDAP_BIND_PASSWORD",
      label: "Bind password",
      group: "Access",
      secret: true,
      required: true,
      dependsOn: { key: "authMode", equals: "ldap" },
    },
    {
      key: "ldapRequiredGroup",
      envVar: "LDAP_REQUIRED_GROUP",
      label: "Required group",
      help: "Only members of this group may sign in.",
      group: "Access",
      advanced: true,
      dependsOn: { key: "authMode", equals: "ldap" },
    },

    // --- how it is reached --------------------------------------------------
    {
      key: "publicBaseUrl",
      envVar: "PUBLIC_BASE_URL",
      label: "Public base URL",
      help: "The address your users' players reach this instance at, e.g. https://tv.example.com/provider-1. Leave blank if it is not published externally.",
      group: "Addressing",
    },
    {
      key: "timezone",
      envVar: "TZ",
      label: "Timezone",
      help: "Must match your players' timezone — catchup depends on it.",
      group: "Addressing",
      default: "Europe/Amsterdam",
    },

    // --- caching ------------------------------------------------------------
    {
      key: "vodCacheEnabled",
      envVar: "VOD_CACHE_ENABLED",
      label: "Cache VOD locally",
      type: "select",
      options: ["true", "false"],
      default: "true",
      group: "Caching",
      advanced: true,
    },
    {
      key: "catchupEnabled",
      envVar: "CATCHUP_ENABLED",
      label: "Buffer live channels for catchup",
      help: "Roughly 18 GB per active channel at 10 Mbps for four hours. Check where your cache path points before turning this on.",
      type: "select",
      options: ["false", "true"],
      default: "false",
      group: "Caching",
      advanced: true,
    },
    {
      key: "catchupDurationHours",
      envVar: "CATCHUP_DURATION_HOURS",
      label: "Hours of catchup to keep",
      group: "Caching",
      default: "4",
      advanced: true,
      dependsOn: { key: "catchupEnabled", equals: "true" },
    },

    // --- health check ---------------------------------------------------------
    //
    // Whether the VPN watchdog watches this instance at all. HEALTHCHECK_TIMES
    // and HEALTHCHECK_MIN_INTERVAL_SECONDS are conspicuously absent: with the
    // watchdog enabled, the Suite's own scheduler decides when to probe, so
    // the instance's own probe schedule is fixed to "off" and its throttle to a
    // short, fixed value — see reconcile/instance.js. A second schedule
    // configured here would just hit the provider twice for the same
    // information.
    {
      key: "healthCheckEnabled",
      envVar: "HEALTHCHECK_ENABLED",
      label: "Watch this instance's provider",
      help: "Lets the VPN watchdog (see the VPN page) reconnect the tunnel when this instance's provider blocks the current exit IP.",
      type: "checkbox",
      default: false,
      group: "Health check",
    },
    {
      key: "healthCheckStreamId",
      envVar: "HEALTHCHECK_STREAM_ID",
      label: "Probe channel id",
      help: "A live channel id from your provider (as it appears in a stream URL) that the instance requests periodically to tell whether the provider is blocking this exit IP.",
      group: "Health check",
      required: true,
      dependsOn: { key: "healthCheckEnabled", equals: true },
    },
    {
      key: "healthCheckBlockedCodes",
      envVar: "HEALTHCHECK_BLOCKED_CODES",
      label: "Blocked status codes",
      help: "Comma-separated HTTP status codes your provider returns when it's blocking this exit IP. Defaults to 456 (the common Xtream convention) when left blank.",
      group: "Health check",
      advanced: true,
      dependsOn: { key: "healthCheckEnabled", equals: true },
    },

    // --- the container itself -----------------------------------------------
    {
      key: "image",
      envVar: null,
      label: "Image",
      help: "Use \"Check for updates\" on this instance to pull this tag and recreate only if it actually changed.",
      group: "Container",
      default: "ghcr.io/x3n0n10/stream-share:latest",
      advanced: true,
    },
    {
      key: "containerName",
      envVar: null,
      label: "Container name",
      help: "Defaults to the Suite's container prefix followed by this instance's slug — see the preview above the Create button. Point it at a container you already run and the Suite will adopt that one instead of creating a second.",
      group: "Container",
      advanced: true,
    },
    {
      key: "port",
      envVar: null,
      label: "Port",
      help: "Allocated automatically from the instance port range set under Stack. Change it only if something else on this host already uses the allocated one.",
      group: "Container",
      advanced: true,
    },
    {
      key: "extraEnv",
      envVar: null,
      label: "Extra environment variables",
      help: "One KEY=VALUE per line, passed straight to the container — for any stream-share setting not modelled above. Not validated, and a field above always wins if it sets the same key.",
      type: "textarea",
      group: "Container",
      advanced: true,
    },
  ],
};
