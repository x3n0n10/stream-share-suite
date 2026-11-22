import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useDelayedUnmount } from "../lib/useDelayedUnmount.js";
import { ConfirmDialog } from "./common.jsx";
import VersionBlock from "./VersionBlock.jsx";
import {
  IconOverview,
  IconHistory,
  IconTrophy,
  IconUsers,
  IconServer,
  IconShield,
  IconSearch,
  IconGlobe,
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
import { useActiveStreams } from "../lib/ActiveStreamsContext.jsx";
import { api } from "../lib/api.js";
import LanguagePicker from "./LanguagePicker.jsx";

const NAV_ITEMS = [
  { to: "/", labelKey: "nav.overview", icon: IconOverview, end: true, badge: "activeStreams" },
  { to: "/users", labelKey: "nav.users", icon: IconUsers, requiresInstances: true },
  { to: "/history", labelKey: "nav.history", icon: IconHistory, requiresInstances: true },
  { to: "/leaderboard", labelKey: "nav.leaderboard", icon: IconTrophy, requiresInstances: true },
  { to: "/instances", labelKey: "nav.instances", icon: IconServer },
  { to: "/vod", labelKey: "nav.vod", icon: IconSearch, requiresInstances: true },
  { to: "/shares", labelKey: "nav.shares", icon: IconGlobe, requiresInstances: true },
  { separator: true },
  { to: "/aliases", labelKey: "nav.aliases", icon: IconTag, requiresInstances: true },
  { to: "/vpn", labelKey: "nav.vpn", icon: IconShield, requiresVpn: true },
  { to: "/setup", labelKey: "nav.setup", icon: IconWand },
  { to: "/stack", labelKey: "nav.stack", icon: IconStack },
  { to: "/settings", labelKey: "nav.settings", icon: IconSettings },
];

// Mobile bottom nav only has room for a handful of items — the rest stay
// reachable through the hamburger drawer. Filtering (rather than a fixed
// slice) keeps this list in sync if NAV_ITEMS is ever reordered.
const MOBILE_NAV_PATHS = ["/", "/history", "/vpn", "/vod"];

// An item with no gating flag is always visible. requiresInstances/requiresVpn
// hide it until config confirms the condition holds — see Layout()'s
// hasInstances/vpnAvailable, sourced from GET /api/config's instances[] and
// gluetun.enabled (server/src/routes/index.js).
function isNavItemVisible(item, { hasInstances, vpnAvailable }) {
  if (item.requiresInstances && !hasInstances) return false;
  if (item.requiresVpn && !vpnAvailable) return false;
  return true;
}

// A nav icon, with a count bubble on its corner when the item has a badge and
// the count is above zero. The count is also read out for screen readers.
function NavIcon({ item }) {
  const { t } = useTranslation();
  const activeStreams = useActiveStreams();
  const count = item.badge === "activeStreams" ? activeStreams : 0;
  return (
    <span className="relative shrink-0">
      <item.icon className="h-5 w-5" />
      {count > 0 && (
        <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-500 px-1 text-[10px] font-bold leading-none text-white">
          {count > 99 ? "99+" : count}
          <span className="sr-only"> {t("nav.activeStreams")}</span>
        </span>
      )}
    </span>
  );
}

function NavList({ items, onNavigate, collapsed = false }) {
  const { t } = useTranslation();
  return (
    <nav className="flex flex-1 flex-col gap-1 px-3">
      {items.map((item, index) =>
        item.separator ? (
          <hr key={`separator-${index}`} className="my-2 border-slate-200 dark:border-slate-800" />
        ) : (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            title={collapsed ? t(item.labelKey) : undefined}
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
            <NavIcon item={item} />
            <span className={collapsed ? "sr-only" : ""}>{t(item.labelKey)}</span>
          </NavLink>
        )
      )}
    </nav>
  );
}

export default function Layout({ title, children, headerExtra }) {
  const { t } = useTranslation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerMounted = useDelayedUnmount(drawerOpen, 220);
  const [theme, toggleTheme] = useTheme();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("layout.sidebarCollapsed") === "1");
  const [signOutOpen, setSignOutOpen] = useState(false);
  const config = useConfig();
  const siteTitle = config?.title || "StreamShare Suite";
  const hasInstances = (config?.instances?.length ?? 0) > 0;
  const vpnAvailable = !!config?.gluetun?.enabled;
  const visibleNavItems = NAV_ITEMS.filter(
    (item) => item.separator || isNavItemVisible(item, { hasInstances, vpnAvailable })
  );
  const mobileNavItems = visibleNavItems.filter(
    (item) => !item.separator && MOBILE_NAV_PATHS.includes(item.to)
  );

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
        <NavList items={visibleNavItems} collapsed={collapsed} />
        {!collapsed && <VersionBlock />}
        <div className="px-3 pt-4">
          <button
            onClick={() => setSignOutOpen(true)}
            title={collapsed ? t("nav.signOut") : undefined}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/60 ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <IconSignOut className="h-5 w-5 shrink-0" />
            <span className={collapsed ? "sr-only" : ""}>{t("nav.signOut")}</span>
          </button>
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
            className={`mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/60 ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <IconChevronDown className={`h-5 w-5 shrink-0 transition-transform ${collapsed ? "-rotate-90" : "rotate-90"}`} />
            <span className={collapsed ? "sr-only" : ""}>{t("nav.collapse")}</span>
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
            <NavList items={visibleNavItems} onNavigate={() => setDrawerOpen(false)} />
            <VersionBlock />
            <div className="px-3 pt-4">
              <button
                onClick={() => {
                  setDrawerOpen(false);
                  setSignOutOpen(true);
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/60"
              >
                <IconSignOut className="h-5 w-5 shrink-0" />
                {t("nav.signOut")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`transition-[padding] duration-200 ${collapsed ? "lg:pl-16" : "lg:pl-60"}`}>
        <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => setDrawerOpen(true)}
              className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden"
            >
              <IconMenu className="h-5 w-5" />
            </button>
            <h1 title={title} className="truncate text-lg font-semibold text-slate-900 dark:text-white">{title}</h1>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            {headerExtra}
            <LanguagePicker />
            <button
              onClick={toggleTheme}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label={t("nav.toggleTheme")}
            >
              {theme === "dark" ? <IconSun className="h-4 w-4" /> : <IconMoon className="h-4 w-4" />}
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 pb-24 sm:px-6 lg:pb-6">{children}</main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 lg:hidden">
        {mobileNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${
                isActive
                  ? "text-accent-600 dark:text-accent-400"
                  : "text-slate-500 dark:text-slate-500"
              }`
            }
          >
            <NavIcon item={item} />
            {t(item.labelKey)}
          </NavLink>
        ))}
      </nav>

      <ConfirmDialog
        open={signOutOpen}
        title={t("nav.signOutTitle")}
        body={t("nav.signOutBody")}
        confirmLabel={t("nav.signOut")}
        onConfirm={signOut}
        onCancel={() => setSignOutOpen(false)}
      />
    </div>
  );
}
