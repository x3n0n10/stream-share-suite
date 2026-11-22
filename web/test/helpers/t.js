import { readFileSync } from "node:fs";

const en = JSON.parse(readFileSync(new URL("../../src/locales/en/translation.json", import.meta.url), "utf8"));

// A minimal `t` over the en strings: dotted keys and {{param}} interpolation, no plurals.
export const t = (key, opts = {}) =>
  key.split(".").reduce((o, k) => o?.[k], en).replace(/{{(\w+)}}/g, (_, k) => opts[k]);
