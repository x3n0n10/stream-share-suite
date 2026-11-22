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
        const field = kind
          ? t(`schema.${kind}.fields.${e.key}.label`, { defaultValue: e.key })
          : e.key;
        return serverText(t, "validation", { ...e, params: { field, ...e.params } }, e.message);
      })
      .join(" ");
  }
  return serverText(t, "errors", err.body, err.message);
}

export function jobLine(t, entry) {
  return serverText(t, "log", entry, entry.line ?? entry);
}
