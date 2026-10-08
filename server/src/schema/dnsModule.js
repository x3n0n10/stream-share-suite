// A Go package path, optionally with an @version suffix, as `caddy
// add-package` takes it. Deliberately strict: it ends up as an argument to a
// shell script, so anything with a space, quote, ;, $ or backtick is refused
// here rather than escaped later.
//
// Always pin a version. Confirmed in a real deployment: without @version,
// add-package does not necessarily build a module's latest tagged release —
// it can build its unreleased branch HEAD instead.
export const MODULE_PATH = /^[A-Za-z0-9][A-Za-z0-9._~-]*(\/[A-Za-z0-9._~-]+)+(@[A-Za-z0-9._+-]+)?$/;
