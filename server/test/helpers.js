// Each test case gets its own in-memory store so nothing leaks between them.

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _setDatabaseForTests, closeDatabase } from "../src/store/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function freshDatabase() {
  closeDatabase();
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(path.join(__dirname, "..", "src", "store", "schema.sql"), "utf8"));
  db.prepare("INSERT INTO schema_version (version) VALUES (1)").run();
  _setDatabaseForTests(db);
  return db;
}
