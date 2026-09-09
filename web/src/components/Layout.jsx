import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useDelayedUnmount } from "../lib/useDelayedUnmount.js";
import { ConfirmDialog } from "./common.jsx";
import {
  IconOverview,
  IconHistory,
  IconTrophy,
  IconUsers,
  IconServer,
  IconShield,
  IconSearch,
  IconTag,
  IconSun,
  IconMoon,
  IconMenu,
  IconClose,
  IconSettings,
  IconSignOut,
  IconStack,
  IconWand,
  IconChevronDown,
} from "./Icons.jsx";
import { useTheme } from "../lib/useTheme.js";
import { useConfig } from "../lib/ConfigContext.jsx";
import { api } from "../lib/api.js";

const NAV_ITEMS = [
  { to: "/", label: "Overview", icon: IconOverview, end: true },
  { to: "/users", label: "Users", icon: IconUsers },
  { to: "/history", label: "History", icon: IconHistory },
  { to: "/leaderboard", label: "Leaderboard", icon: IconTrophy },
  { to: "/instances", label: "Instances", icon: IconServer },
  { to: "/vod", label: "VOD search", icon: IconSearch },
  { separator: true },
  { to: "/aliases", label: "Aliases", icon: IconTag },
  { to: "/vpn", label: "VPN", icon: IconShield },
  { to: "/setup", label: "Setup wizard", icon: IconWand },
  { to: "/stack", label: "Stack", icon: IconStack },
  { to: "/settings", label: "Settings", icon: IconSettings },
];

// Mobile bottom nav only has room for a handful of items — the rest stay
// reachable through the hamburger drawer. Filtering (rather than a fixed
// slice) keeps this list in sync if NAV_ITEMS is ever reordered.
const MOBILE_NAV_PATHS = ["/", "/history", "/vpn", "/vod"];
const MOBILE_NAV_ITEMS = NAV_ITEMS.filter((item) => MOBILE_NAV_PATHS.includes(item.to));

function NavList({ onNavigate, collapsed = false }) {
  return (
    <nav className="flex flex-1 flex-col gap-1 px-3">
      {NAV_ITEMS.map((item, index) =>
        item.separator ? (
          <hr key={`separator-${index}`} className="my-2 border-slate-200 dark:border-slate-800" />
        ) : (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                collapsed ? "justify-center" : ""
              } ${
                isActive
                  ? "bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/60"
              }`
            }
          >
            <item.icon className="h-5 w-5 shrink-0" />
            <span className={collapsed ? "sr-only" : ""}>{item.label}</span>
          </NavLink>
        )
      )}
    </nav>
  );
}

export default function Layout({ title, children, headerExtra }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerMounted = useDelayedUnmount(drawerOpen, 220);
  const [theme, toggleTheme] = useTheme();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("layout.sidebarCollapsed") === "1");
  const [signOutOpen, setSignOutOpen] = useState(false);
  const config = useConfig();
  const siteTitle = config?.title || "StreamShare Suite";

  useEffect(() => {
    localStorage.setItem("layout.sidebarCollapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  // The api layer's 401 handler is what actually returns the UI to the sign-in
  // screen, so this only has to make the next request unauthenticated.
  async function signOut() {
    setSignOutOpen(false);
    try {
      await api.logout();
    } finally {
      window.location.assign("/");
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Desktop sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 hidden flex-col border-r border-slate-200 bg-white py-5 transition-[width] duration-200 dark:border-slate-800 dark:bg-slate-900 lg:flex ${
          collapsed ? "lg:w-16" : "lg:w-60"
        }`}
      >
        <div className={`mb-6 flex min-w-0 items-center gap-2 px-4 ${collapsed ? "justify-center px-0" : ""}`}>
          <img src="/logo.svg" alt="" className="h-7 w-7 shrink-0 rounded-lg" />
          <span className={`truncate text-sm font-semibold text-slate-900 dark:text-white ${collapsed ? "sr-only" : ""}`}>
            {siteTitle}
          </span>
        </div>
        <NavList collapsed={collapsed} />
        <div className="px-3 pt-4">
          <button
            onClick={() => setSignOutOpen(true)}
            title={collapsed ? "Sign out" : undefined}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/60 ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <IconSignOut className="h-5 w-5 shrink-0" />
            <span className={collapsed ? "sr-only" : ""}>Sign out</span>
          </button>
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/60 ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <IconChevronDown className={`h-5 w-5 shrink-0 transition-transform ${collapsed ? "-rotate-90" : "rotate-90"}`} />
            <span className={collapsed ? "sr-only" : ""}>Collapse</span>
          </button>
        </div>
      </aside>

      {/* Mobile drawer */}
      {drawerMounted && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ease-out ${
              drawerOpen ? "opacity-100" : "opacity-0"
            }`}
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div
            className={`absolute inset-y-0 left-0 flex w-64 flex-col bg-white py-5 transition-transform duration-200 ease-drawer motion-reduce:transition-opacity dark:bg-slate-900 ${
              drawerOpen ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            <div className="mb-6 flex items-center justify-between gap-2 px-4">
              <div className="flex min-w-0 items-center gap-2">
                <img src="/logo.svg" alt="" className="h-7 w-7 shrink-0 rounded-lg" />
                <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                  {siteTitle}
                </span>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <IconClose className="h-5 w-5" />
              </button>
            </div>
            <NavList onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      <div className={`transition-[padding] duration-200 ${collapsed ? "lg:pl-16" : "lg:pl-60"}`}>
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => setDrawerOpen(true)}
              className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden"
            >
              <IconMenu className="h-5 w-5" />
            </button>
            <h1 className="truncate text-lg font-semibold text-slate-900 dark:text-white">{title}</h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {headerExtra}
            <button
              onClick={toggleTheme}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <IconSun className="h-4 w-4" /> : <IconMoon className="h-4 w-4" />}
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 pb-24 sm:px-6 lg:pb-6">{children}</main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 lg:hidden">
        {MOBILE_NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${
                isActive
                  ? "text-accent-600 dark:text-accent-400"
                  : "text-slate-500 dark:text-slate-500"
              }`
            }
          >
            <Icon className="h-5 w-5" />
            {label}
          </NavLink>
        ))}
      </nav>

      <ConfirmDialog
        open={signOutOpen}
        title="Sign out?"
        body="You'll need to sign in again to get back in."
        confirmLabel="Sign out"
        onConfirm={signOut}
        onCancel={() => setSignOutOpen(false)}
      />
    </div>
  );
}
