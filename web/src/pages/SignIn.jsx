import { useState } from "react";
import { api } from "../lib/api.js";
import { Button, ErrorNote } from "../components/common.jsx";

// One screen for both first-run setup and ordinary sign-in — they share every
// field and differ only in the copy and which endpoint they post to, so
// splitting them would duplicate the form for nothing.
export default function SignIn({ setupRequired, onAuthenticated }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError(null);

    if (setupRequired && password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const result = setupRequired
        ? await api.setup(username, password)
        : await api.login(username, password);
      onAuthenticated(result);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
    "placeholder:text-slate-400 focus:border-accent-500 focus:outline-none focus:ring-1 " +
    "focus:ring-accent-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <img src="/logo.svg" alt="" className="h-9 w-9 rounded-lg" />
          <span className="text-lg font-semibold text-slate-900 dark:text-white">
            StreamShare Suite
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <h1 className="text-base font-semibold text-slate-900 dark:text-white">
            {setupRequired ? "Create your admin account" : "Sign in"}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {setupRequired
              ? "This is the only account. Nothing else works until it exists."
              : "Enter your credentials to continue."}
          </p>

          <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Username</span>
              <input
                className={field}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Password</span>
              <input
                className={field}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={setupRequired ? "new-password" : "current-password"}
                required
              />
              {setupRequired && (
                <span className="text-[11px] text-slate-400 dark:text-slate-500">
                  At least 12 characters. There is no recovery — store it somewhere safe.
                </span>
              )}
            </label>

            {setupRequired && (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Confirm password
                </span>
                <input
                  className={field}
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>
            )}

            {error && <ErrorNote message={error} />}

            <div className="mt-1">
              <Button type="submit" tone="accent" loading={busy} disabled={busy}>
                {setupRequired ? "Create account" : "Sign in"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
