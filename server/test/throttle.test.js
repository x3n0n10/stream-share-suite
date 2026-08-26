// The login throttle is the one place where `trust proxy` bites: req.ip comes
// from a client-supplied header, so the per-IP budget alone is spoofable.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  _resetLoginThrottle,
  clearLoginAttempts,
  recordFailedLogin,
  throttleLogin,
} from "../src/auth/middleware.js";

beforeEach(() => _resetLoginThrottle());

// Minimal express-shaped doubles — the middleware only touches req.ip and the
// three response methods below.
function run(ip) {
  const req = { ip };
  let statusCode = null;
  let payload = null;
  let passed = false;
  const res = {
    set() {},
    status(code) {
      statusCode = code;
      return res;
    },
    json(body) {
      payload = body;
      return res;
    },
  };
  throttleLogin(req, res, () => {
    passed = true;
  });
  return { passed, statusCode, payload, req };
}

test("a client is blocked after ten failures from the same address", () => {
  const req = { ip: "10.0.0.1" };
  for (let i = 0; i < 10; i++) recordFailedLogin(req);

  const result = run("10.0.0.1");
  assert.equal(result.passed, false);
  assert.equal(result.statusCode, 429);
  assert.match(result.payload.error, /Too many sign-in attempts/);
});

test("another address is unaffected by the first one's failures", () => {
  const req = { ip: "10.0.0.1" };
  for (let i = 0; i < 10; i++) recordFailedLogin(req);

  assert.equal(run("10.0.0.2").passed, true);
});

test("rotating the address does not buy unlimited attempts", () => {
  // What an attacker does when req.ip comes from X-Forwarded-For: a fresh
  // address every attempt, so the per-IP counter never trips.
  for (let i = 0; i < 30; i++) recordFailedLogin({ ip: `10.0.1.${i}` });

  const result = run("10.0.99.99");
  assert.equal(result.passed, false, "the global ceiling must still stop it");
  assert.equal(result.statusCode, 429);
});

test("a success clears that client's budget but not the global one", () => {
  const victim = { ip: "10.0.0.5" };
  for (let i = 0; i < 9; i++) recordFailedLogin(victim);
  clearLoginAttempts(victim);
  assert.equal(run("10.0.0.5").passed, true);

  // The global count is untouched, so a run already in progress is not reset
  // by one valid sign-in landing in the middle of it.
  for (let i = 0; i < 21; i++) recordFailedLogin({ ip: `10.0.2.${i}` });
  assert.equal(run("10.0.0.5").passed, false);
});

test("a caller with no resolvable address is still counted", () => {
  for (let i = 0; i < 10; i++) recordFailedLogin({});
  assert.equal(run(undefined).passed, false);
});

test("the throttle lets everything through from a clean slate", () => {
  assert.equal(run("10.0.0.1").passed, true);
});
