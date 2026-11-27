// Sign-in, first-run setup, and password change.
//
// /status is the only endpoint here that answers before authentication: the
// frontend needs to know whether to render a login form or a setup form, and
// both facts (is there an admin, am I signed in) are unavoidably public.

import { Router } from "express";
import {
  sessionCookieName,
  createSession,
  destroyAllSessions,
  destroySession,
  csrfTokenFor,
} from "../auth/sessions.js";
import {
  clearLoginAttempts,
  isSecureRequest,
  recordFailedLogin,
  requireAuth,
  requireCsrf,
  serializeCookie,
  throttleLogin,
} from "../auth/middleware.js";
import { changePassword, checkCredentials, countUsers, createUser } from "../auth/users.js";
import { validatePassword } from "../auth/passwords.js";
import { revokeApiToken } from "../auth/apiToken.js";
import { SuiteError, sendError } from "../errors.js";

const SETUP_DONE = new SuiteError("setup_complete", "Setup has already been completed.");

function setSessionCookie(req, res, session) {
  res.set(
    "Set-Cookie",
    serializeCookie(sessionCookieName(req), session.token, {
      maxAgeMs: session.maxAgeMs,
      secure: isSecureRequest(req),
    })
  );
}

function normaliseUsername(value) {
  return String(value || "").trim().toLowerCase();
}

export function createAuthRouter() {
  const router = Router();

  router.get("/status", (req, res) => {
    res.json({
      setupRequired: countUsers() === 0,
      authenticated: !!req.user,
      username: req.user ? req.user.username : null,
      // The frontend echoes this on state-changing requests; see requireCsrf.
      csrfToken: req.sessionToken ? csrfTokenFor(req.sessionToken) : null,
    });
  });

  // First run only. Guarded by the user count rather than by auth, and the
  // guard is re-checked inside so two simultaneous setup posts cannot both
  // create an admin.
  router.post("/setup", async (req, res) => {
    if (countUsers() > 0) {
      return sendError(res, 409, SETUP_DONE);
    }

    const username = normaliseUsername(req.body.username);
    const { password } = req.body;

    if (!username || username.length < 3) {
      return sendError(res, 400, new SuiteError("username_too_short", "Username must be at least 3 characters.", { min: 3 }));
    }
    const pwError = validatePassword(password);
    if (pwError) return sendError(res, 400, pwError);

    let user;
    try {
      user = await createUser(username, password);
    } catch {
      return sendError(res, 409, SETUP_DONE);
    }

    const session = createSession(user.id, { userAgent: req.get("User-Agent") });
    setSessionCookie(req, res, session);
    res.json({ username: user.username, csrfToken: csrfTokenFor(session.token) });
  });

  router.post("/login", throttleLogin, async (req, res) => {
    const username = normaliseUsername(req.body.username);
    const { password } = req.body;

    if (!username || !password) {
      return sendError(res, 400, new SuiteError("login_fields_required", "Username and password are required."));
    }

    const user = await checkCredentials(username, password);
    if (!user) {
      recordFailedLogin(req);
      // One message for both "no such user" and "wrong password" — the timing
      // is already equalised in checkCredentials.
      return sendError(res, 401, new SuiteError("bad_credentials", "Incorrect username or password."));
    }

    clearLoginAttempts(req);
    const session = createSession(user.id, { userAgent: req.get("User-Agent") });
    setSessionCookie(req, res, session);
    res.json({ username: user.username, csrfToken: csrfTokenFor(session.token) });
  });

  router.post("/logout", requireCsrf, (req, res) => {
    destroySession(req.sessionToken);
    res.set("Set-Cookie", serializeCookie(sessionCookieName(req), "", { expires: true }));
    res.json({ ok: true });
  });

  // Changing the password invalidates every other session and the API token:
  // whoever got in with the old credentials should not stay in.
  router.post("/password", requireAuth, requireCsrf, async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    const user = await checkCredentials(req.user.username, currentPassword || "");
    if (!user) return sendError(res, 401, new SuiteError("current_password_incorrect", "Current password is incorrect."));

    const pwError = validatePassword(newPassword);
    if (pwError) return sendError(res, 400, pwError);

    await changePassword(req.user.userId, newPassword);
    destroyAllSessions(req.user.userId, { exceptToken: req.sessionToken });
    revokeApiToken();
    res.json({ ok: true });
  });

  return router;
}
