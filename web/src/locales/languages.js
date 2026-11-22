// No imports: the browser and node --test both load this file directly.
export const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "nl", name: "Nederlands" },
  { code: "de", name: "Deutsch" },
  { code: "fr", name: "Français" },
  { code: "es", name: "Español" },
];

export function resolveLanguage(browserLanguage) {
  const base = String(browserLanguage || "").toLowerCase().split("-")[0];
  return LANGUAGES.some((l) => l.code === base) ? base : "en";
}
