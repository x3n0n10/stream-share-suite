# Development

Run the backend tests and the frontend dev server:

```sh
cd server && npm install && npm test     # backend and API tests
cd web && npm install && npm run dev     # frontend on :5173, proxying to :3000
```

To run the backend against a local data directory:

```sh
cd server && SUITE_DATA_DIR=../data PORT=3000 npm start
```

## Translations

The web UI is translated with i18next. Strings live in `web/src/locales/<code>/translation.json`; English (`en`) is the source and the fallback, so a missing key shows the English text.

- Keys are nested by page or area and named after what the text is (`vpn.status.connected`, `common.save`), not after the English wording.
- Placeholders use `{{name}}`, plurals use `_one` / `_other` keys with `count`, and sentences with markup use `<Trans>` with named tags. Translations must keep the same placeholders and tags as English.
- Edit the JSON files directly on GitHub, or with the [i18n Ally](https://marketplace.visualstudio.com/items?itemName=Lokalise.i18n-ally) VS Code extension (configured in `.vscode/settings.json`).
- `cd web && npm test` checks every locale against English (unknown keys, differing placeholders or tags).
- To add a language, create `web/src/locales/<code>/translation.json` and add one entry to `LANGUAGES` in `web/src/locales/languages.js`.
