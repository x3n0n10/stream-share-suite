import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers.js";
import {
  createInstance,
  deleteInstance,
  getInstance,
  listInstances,
  reorderInstances,
  slugify,
  toPublic,
  updateInstance,
} from "../src/store/instances.js";

beforeEach(() => freshDatabase());

test("slugs are derived from the name and stay unique", () => {
  createInstance({ name: "Provider 1", url: "http://a:8080", apiKey: "k" });
  const second = createInstance({ name: "Provider 1", url: "http://b:8080", apiKey: "k" });
  assert.equal(getInstance("provider-1").url, "http://a:8080");
  assert.equal(second.id, "provider-1-2");
});

test("trailing slashes are stripped so instance URLs concatenate cleanly", () => {
  const made = createInstance({ name: "P", url: "http://a:8080///", apiKey: "k" });
  assert.equal(made.url, "http://a:8080");
});

test("toPublic never exposes the API key", () => {
  const made = createInstance({ name: "P", url: "http://a:8080", apiKey: "super-secret" });
  const pub = toPublic(made);
  assert.equal(pub.apiKeySet, true);
  assert.equal(JSON.stringify(pub).includes("super-secret"), false);
  assert.equal("apiKey" in pub, false);
});

test("an omitted apiKey leaves the stored key alone, null clears it", () => {
  createInstance({ name: "P", url: "http://a:8080", apiKey: "keep-me" });

  updateInstance("p", { name: "Renamed" });
  assert.equal(getInstance("p").apiKey, "keep-me");
  assert.equal(getInstance("p").name, "Renamed");

  updateInstance("p", { apiKey: "replaced" });
  assert.equal(getInstance("p").apiKey, "replaced");

  updateInstance("p", { apiKey: null });
  assert.equal(getInstance("p").apiKey, "");
});

test("disabled instances are hidden from the request path but not from settings", () => {
  createInstance({ name: "On", url: "http://a:8080", apiKey: "k" });
  createInstance({ name: "Off", url: "http://b:8080", apiKey: "k", enabled: false });

  assert.deepEqual(listInstances().map((i) => i.id), ["on"]);
  assert.deepEqual(listInstances({ includeDisabled: true }).map((i) => i.id), ["on", "off"]);
});

test("reordering changes list order", () => {
  createInstance({ name: "A", url: "http://a:8080", apiKey: "k" });
  createInstance({ name: "B", url: "http://b:8080", apiKey: "k" });
  createInstance({ name: "C", url: "http://c:8080", apiKey: "k" });

  reorderInstances(["c", "a", "b"]);
  assert.deepEqual(listInstances().map((i) => i.id), ["c", "a", "b"]);
});

test("deleting reports whether anything was removed", () => {
  createInstance({ name: "A", url: "http://a:8080", apiKey: "k" });
  assert.equal(deleteInstance("a"), true);
  assert.equal(deleteInstance("a"), false);
});

test("a name with no usable characters still yields a slug", () => {
  assert.equal(slugify("!!!"), "instance");
});
