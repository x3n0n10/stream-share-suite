import { useCallback, useEffect, useState } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import Overview from "./pages/Overview.jsx";
import History from "./pages/History.jsx";
import Leaderboard from "./pages/Leaderboard.jsx";
import Users from "./pages/Users.jsx";
import Instances from "./pages/Instances.jsx";
import Vpn from "./pages/Vpn.jsx";
import Vod from "./pages/Vod.jsx";
import Aliases from "./pages/Aliases.jsx";
import Settings from "./pages/Settings.jsx";
import Stack from "./pages/Stack.jsx";
import Setup from "./pages/Setup.jsx";
import SignIn from "./pages/SignIn.jsx";
import { api, setCsrfToken, setUnauthorizedHandler } from "./lib/api.js";
import { ConfigProvider } from "./lib/ConfigContext.jsx";

// Four states, and they have to be distinguished: still checking, no admin
// exists yet, signed out, signed in. Collapsing the first into the third
// flashes a login form on every reload.
const CHECKING = "checking";
const SETUP = "setup";
const SIGNED_OUT = "signed-out";
const SIGNED_IN = "signed-in";

export default function App() {
  const [authState, setAuthState] = useState(CHECKING);
  const [config, setConfig] = useState(null);
  const navigate = useNavigate();

  const loadConfig = useCallback(async () => {
    try {
      const c = await api.config();
      setConfig(c);
      document.title = c.title;
    } catch {
      // A 401 here is already handled by the unauthorized handler below; any
      // other failure should still leave the shell usable.
      setConfig((prev) => prev || { title: "StreamShare Suite", pollIntervalMs: 15000 });
    }
  }, []);

  // Any 401 from anywhere returns the whole UI to the right auth screen,
  // rather than leaving a page polling into a void.
  useEffect(() => {
    setUnauthorizedHandler((payload) => {
      setConfig(null);
      setAuthState(payload?.setupRequired ? SETUP : SIGNED_OUT);
    });
  }, []);

  useEffect(() => {
    api
      .authStatus()
      .then((status) => {
        setCsrfToken(status.csrfToken);
        if (status.setupRequired) setAuthState(SETUP);
        else if (status.authenticated) setAuthState(SIGNED_IN);
        else setAuthState(SIGNED_OUT);
      })
      .catch(() => setAuthState(SIGNED_OUT));
  }, []);

  useEffect(() => {
    if (authState === SIGNED_IN) loadConfig();
  }, [authState, loadConfig]);

  // Nothing to manage yet — send a freshly signed-in user straight to the
  // wizard instead of an empty Overview. Fires once per sign-in transition,
  // not on every render, so navigating away from /setup afterward sticks.
  useEffect(() => {
    if (authState !== SIGNED_IN) return;
    api
      .stackInstances()
      .then((result) => {
        if (result.instances.length === 0) navigate("/setup");
      })
      .catch(() => {});
  }, [authState, navigate]);

  if (authState === CHECKING) {
    return <div className="min-h-screen bg-slate-50 dark:bg-slate-950" />;
  }

  if (authState !== SIGNED_IN) {
    return (
      <SignIn
        setupRequired={authState === SETUP}
        onAuthenticated={(result) => {
          setCsrfToken(result.csrfToken);
          setAuthState(SIGNED_IN);
        }}
      />
    );
  }

  const pollIntervalMs = config?.pollIntervalMs || 15000;

  return (
    <ConfigProvider config={config}>
      <Routes>
        <Route path="/" element={<Overview pollIntervalMs={pollIntervalMs} />} />
        <Route path="/history" element={<History pollIntervalMs={pollIntervalMs} />} />
        <Route path="/leaderboard" element={<Leaderboard pollIntervalMs={pollIntervalMs} />} />
        <Route path="/users" element={<Users pollIntervalMs={pollIntervalMs} />} />
        <Route path="/aliases" element={<Aliases pollIntervalMs={pollIntervalMs} />} />
        <Route path="/instances" element={<Instances pollIntervalMs={pollIntervalMs} />} />
        <Route path="/vpn" element={<Vpn pollIntervalMs={pollIntervalMs} />} />
        <Route path="/vod" element={<Vod />} />
        <Route path="/settings" element={<Settings onConfigChanged={loadConfig} />} />
        <Route path="/stack" element={<Stack pollIntervalMs={pollIntervalMs} />} />
        <Route path="/setup" element={<Setup />} />
      </Routes>
    </ConfigProvider>
  );
}
