import { test } from "node:test";
import assert from "node:assert/strict";
import { serverText, errorText, jobLine } from "../src/lib/serverText.js";
import { describeFailures } from "../src/lib/applyToAll.js";

const dict = {
  "validation.username_too_short": "Gebruikersnaam moet minstens {{min}} tekens hebben.",
  "validation.required": "{{field}} is verplicht.",
  "schema.instance.fields.displayName.label": "Weergavenaam",
  "log.pulled_image": "Image {{image}} opgehaald",
  "common.failedOn": "Mislukt op {{list}}",
};
const t = (key, opts = {}) =>
  dict[key] ? dict[key].replace(/{{(\w+)}}/g, (_, k) => opts[k]) : opts.defaultValue;
const apiError = (message, body) => Object.assign(new Error(message), { body });

test("serverText translates a known code with params", () => {
  const item = { code: "username_too_short", params: { min: 3 } };
  assert.equal(serverText(t, "validation", item, "Too short"), "Gebruikersnaam moet minstens 3 tekens hebben.");
});

test("serverText falls back to the server's English", () => {
  assert.equal(serverText(t, "validation", { code: "nope" }, "English"), "English");
  assert.equal(serverText(t, "validation", undefined, "English"), "English");
});

test("errorText without code", () => {
  assert.equal(errorText(apiError("Boom", { error: "Boom" }), t), "Boom");
  assert.equal(errorText(new Error("Plain"), t), "Plain");
});

test("errorText joins translated validation errors", () => {
  const err = apiError("Invalid", {
    kind: "instance",
    errors: [
      { key: "displayName", code: "required", message: "Name is required." },
      { key: "x", message: "Other." },
    ],
  });
  assert.equal(errorText(err, t), "Weergavenaam is verplicht. Other.");
});

test("jobLine handles legacy strings and coded entries", () => {
  assert.equal(jobLine(t, "Pulled image"), "Pulled image");
  assert.equal(jobLine(t, { line: "Pulled x", code: "pulled_image", params: { image: "x" } }), "Image x opgehaald");
});

test("describeFailures names each failed instance", () => {
  const results = [{ status: "fulfilled" }, { status: "rejected", reason: new Error("down") }];
  assert.equal(describeFailures([{ name: "A" }, { name: "B" }], results, t), "Mislukt op B (down)");
  assert.equal(describeFailures([{ name: "A" }], [{ status: "fulfilled" }], t), null);
});

test("renders legacy string log entries", () => {
  assert.equal(jobLine(t, "Reconnect attempt 1/3..."), "Reconnect attempt 1/3...");
});
