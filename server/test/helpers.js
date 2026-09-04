// Each test case gets its own in-memory store so nothing leaks between them.

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _setDatabaseForTests, closeDatabase, SCHEMA_VERSION } from "../src/store/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function freshDatabase() {
  closeDatabase();
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(path.join(__dirname, "..", "src", "store", "schema.sql"), "utf8"));
  // schema.sql is the current shape, so the marker has to say so — a stale
  // literal here would let a migration test pass against an unmigrated store.
  db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
  _setDatabaseForTests(db);
  return db;
}

// Threads the session cookie and the CSRF echo through a real HTTP server the
// way the browser client does — shared by every end-to-end test file so the
// auth boundary is exercised identically everywhere it's touched.
export function apiClient(base) {
  let cookie = null;
  let csrf = null;

  async function call(method, path, body) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrf ? { "X-Suite-CSRF": csrf } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const json = await res.json().catch(() => ({}));
    if (json.csrfToken) csrf = json.csrfToken;
    return { status: res.status, body: json };
  }

  return {
    get: (p) => call("GET", p),
    post: (p, b) => call("POST", p, b),
    put: (p, b) => call("PUT", p, b),
    del: (p) => call("DELETE", p),
    dropCsrf: () => {
      csrf = null;
    },
    hasCookie: () => !!cookie,

    // For the one pair of endpoints that isn't JSON in and out — a file
    // download, a raw file upload — same cookie/CSRF plumbing as call()
    // above, without assuming either side speaks JSON.
    async getBuffer(p) {
      const res = await fetch(`${base}${p}`, { headers: cookie ? { Cookie: cookie } : {} });
      return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()) };
    },
    async postBuffer(p, buffer, contentType) {
      const res = await fetch(`${base}${p}`, {
        method: "POST",
        headers: {
          "Content-Type": contentType,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(csrf ? { "X-Suite-CSRF": csrf } : {}),
        },
        body: buffer,
      });
      const json = await res.json().catch(() => ({}));
      return { status: res.status, body: json };
    },
  };
}

export const TEST_PASSWORD = "a-sufficiently-long-password";

export async function signedInClient(base) {
  const c = apiClient(base);
  await c.post("/api/auth/setup", { username: "admin", password: TEST_PASSWORD });
  return c;
}
