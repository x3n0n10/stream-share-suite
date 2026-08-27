// A StreamShare instance: one IPTV provider account, shared with several
// users. This is the first kind of which there can be many, so unlike gluetun
// and postgres its components carry a key.
//
// stream-share reads roughly fifty environment variables. Modelling all of
// them would be a worse form than modelling the dozen that decide whether it
// runs at all, so the rest go through extraEnv — the same escape hatch the
// gluetun schema uses for its long tail of providers.
//
// Five values are conspicuously absent because the Suite computes them rather
// than asking (see reconcile/instance.js):
//
//   PORT                  allocated from a band, so two instances cannot clash
//   INTERNAL_API_KEY      generated, so an instance is reachable by the
//                         dashboard the moment it exists and nobody types a key
//   DB_*                  derived from the postgres component plus this
//                         instance's own generated database and role
//   INSTANCE_NAME         the display name below
//   CACHE_FOLDER          fixed at the mount point of the cache volume

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

    // --- the container itself -----------------------------------------------
    {
      key: "image",
      envVar: null,
      label: "Image",
      help: "Release channels arrive in phase 4; until then this is the tag it runs.",
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
      help: "Allocated automatically from 8080 upwards. Change it only if something else on this host already uses the allocated one.",
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
