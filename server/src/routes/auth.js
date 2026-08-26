// Sign-in, first-run setup, and password change.
//
// /status is the only endpoint here that answers before authentication: the
// frontend needs to know whether to render a login form or a setup form, and
// both facts (is there an admin, am I signed in) are unavoidably public.

import { Router } from "express";
import {
  SESSION_COOKIE,
  createSession,
  destroyAllSessions,
  destroySession,
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

function setSessionCookie(req, res, session) {
  res.set(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, session.token, {
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
      csrfToken: req.sessionToken || null,
    });
  });

  // First run only. Guarded by the user count rather than by auth, and the
  // guard is re-checked inside so two simultaneous setup posts cannot both
  // create an admin.
  router.post("/setup", async (req, res) => {
    if (countUsers() > 0) {
      return res.status(409).json({ error: "Setup has already been completed." });
    }

    const username = normaliseUsername(req.body.username);
    const { password } = req.body;

    if (!username || username.length < 3) {
      return res.status(400).json({ error: "Username must be at least 3 characters." });
    }
    const pwError = validatePassword(password);
    if (pwError) return res.status(400).json({ error: pwError });

    let user;
    try {
      user = await createUser(username, password);
    } catch {
      return res.status(409).json({ error: "Setup has already been completed." });
    }

    const session = createSession(user.id, { userAgent: req.get("User-Agent") });
    setSessionCookie(req, res, session);
    res.json({ username: user.username, csrfToken: session.token });
  });

  router.post("/login", throttleLogin, async (req, res) => {
    const username = normaliseUsername(req.body.username);
    const { password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required." });
    }

    const user = await checkCredentials(username, password);
    if (!user) {
      recordFailedLogin(req);
      // One message for both "no such user" and "wrong password" — the timing
      // is already equalised in checkCredentials.
      return res.status(401).json({ error: "Incorrect username or password." });
    }

    clearLoginAttempts(req);
    const session = createSession(user.id, { userAgent: req.get("User-Agent") });
    setSessionCookie(req, res, session);
    res.json({ username: user.username, csrfToken: session.token });
  });

  router.post("/logout", requireCsrf, (req, res) => {
    destroySession(req.sessionToken);
    res.set("Set-Cookie", serializeCookie(SESSION_COOKIE, "", { expires: true }));
    res.json({ ok: true });
  });

  // Changing the password invalidates every other session: whoever was signed
  // in with the old one should not stay signed in.
  router.post("/password", requireAuth, requireCsrf, async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    const user = await checkCredentials(req.user.username, currentPassword || "");
    if (!user) return res.status(401).json({ error: "Current password is incorrect." });

    const pwError = validatePassword(newPassword);
    if (pwError) return res.status(400).json({ error: pwError });

    await changePassword(req.user.userId, newPassword);
    destroyAllSessions(req.user.userId, { exceptToken: req.sessionToken });
    res.json({ ok: true });
  });

  return router;
}
