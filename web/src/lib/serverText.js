import { fieldText } from "./schemaKeys.js";

// Translate server-provided text by code, falling back to the server's English.
// Pure (takes `t`) so node --test can load it.
export function serverText(t, ns, item, fallback) {
  return item?.code ? t(`${ns}.${item.code}`, { ...item.params, defaultValue: fallback }) : fallback;
}

export function errorText(err, t) {
  const errors = err.body?.errors;
  if (errors?.length) {
    const kind = err.body.kind;
    return errors
      .map((e) => {
        if (kind && e.code === "pattern") {
          return fieldText(t, kind, e.key, "patternMessage", e.message);
        }
        const field = kind
          ? fieldText(t, kind, e.key, "label", e.key)
          : e.key;
        return serverText(t, "validation", { ...e, params: { field, ...e.params } }, e.message);
      })
      .join(" ");
  }
  return serverText(t, "errors", err.body, err.message);
}

// Text for an ErrorNote: strings pass through, error objects are translated.
export function messageText(message, t) {
  return typeof message === "string" ? message : errorText(message, t);
}

export function jobLine(t, entry) {
  return serverText(t, "log", entry, entry.line ?? entry);
}
