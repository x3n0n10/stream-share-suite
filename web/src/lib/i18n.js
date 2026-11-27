import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import resourcesToBackend from "i18next-resources-to-backend";
import en from "../locales/en/translation.json";
import { resolveLanguage } from "../locales/languages.js";

// localStorage can throw (private mode, blocked storage); the language just won't persist.
function storage(key, value) {
  try {
    return value === undefined ? localStorage.getItem(key) : localStorage.setItem(key, value);
  } catch {
    return null;
  }
}

// English is bundled statically, so the glob excludes it from the lazy chunks.
const lazy = import.meta.glob(["../locales/*/translation.json", "!../locales/en/translation.json"]);

i18n
  .use(resourcesToBackend((lng) => lazy[`../locales/${lng}/translation.json`]()))
  .use(initReactI18next)
  .init({
    lng: resolveLanguage(storage("language") || navigator.language),
    fallbackLng: "en",
    resources: { en: { translation: en } },
    partialBundledLanguages: true,
    interpolation: { escapeValue: false },
  });

i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
  storage("language", lng);
});

export default i18n;
