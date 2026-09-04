import { Fragment, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import { Card, Badge, EmptyState, ErrorNote, Skeleton, Select, Button, RefreshButton, PollStatus } from "../components/common.jsx";
import { IconTag, IconTrash, IconChevronDown } from "../components/Icons.jsx";
import { api } from "../lib/api.js";
import { usePolling } from "../lib/usePolling.js";
import { useConfig } from "../lib/ConfigContext.jsx";
import { formatDateTime } from "../lib/format.js";

function entryKey(a) {
  return `${a.instance_id}::${a.ip_address}`;
}

// An alias means the same thing regardless of which instance a viewer hits,
// but each instance stores its own copy (separate DBs) -- group by IP so
// applying the same alias everywhere shows as one row instead of one per
// instance, and only stands out as "mixed" if a set has actually drifted
// (e.g. someone changed just one instance's copy).
function groupByIp(aliases) {
  const byIp = new Map();
  for (const a of aliases) {
    let group = byIp.get(a.ip_address);
    if (!group) {
      group = { ip_address: a.ip_address, entries: [] };
      byIp.set(a.ip_address, group);
    }
    group.entries.push(a);
  }

  const groups = Array.from(byIp.values());
  for (const g of groups) {
    g.entries.sort((a, b) => a.instance_name.localeCompare(b.instance_name));
    const uniqueAliases = new Set(g.entries.map((e) => e.alias));
    g.mixed = uniqueAliases.size > 1;
    g.alias = g.mixed ? null : g.entries[0].alias;
    g.updatedAt = g.entries.reduce(
      (max, e) => (new Date(e.updated_at) > new Date(max) ? e.updated_at : max),
      g.entries[0].updated_at
    );
  }
  groups.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  return groups;
}

export default function Aliases({ pollIntervalMs }) {
  const config = useConfig();
  const instances = config?.instances || [];
  const multiInstance = instances.length > 1;

  const [search, setSearch] = useState("");
  const { data, error, loading, updatedAt, refresh } = usePolling(() => api.aliases(), pollIntervalMs, []);

  // Supports the "add alias" shortcut linked from an unaliased viewer chip
  // on Overview (?ip=...) — read once at mount, same as any other deep link.
  const [searchParams] = useSearchParams();
  const prefillIp = searchParams.get("ip") || "";

  const [applyToAll, setApplyToAll] = useState(true);
  const [formInstanceId, setFormInstanceId] = useState("");
  const [formIp, setFormIp] = useState(prefillIp);
  const [formAlias, setFormAlias] = useState("");
  const [formError, setFormError] = useState(null);
  const [formSaving, setFormSaving] = useState(false);

  const [rowState, setRowState] = useState({}); // key -> { deleting, error }
  const [expanded, setExpanded] = useState({}); // ip -> bool

  const aliases = data?.aliases || [];
  const groups = useMemo(() => groupByIp(aliases), [aliases]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.ip_address?.toLowerCase().includes(q) ||
        g.entries.some((e) => e.alias?.toLowerCase().includes(q) || e.instance_name?.toLowerCase().includes(q))
    );
  }, [groups, search]);

  const instanceId = formInstanceId || instances[0]?.id || "";

  function patchRow(key, patch) {
    setRowState((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  function describeFailures(targets, results) {
    const failed = results
      .map((r, idx) => ({ r, instance: targets[idx] }))
      .filter(({ r }) => r.status === "rejected");
    if (failed.length === 0) return null;
    return `Failed on ${failed.map(({ instance, r }) => `${instance.name} (${r.reason.message})`).join(", ")}`;
  }

  async function submitAlias(e) {
    e.preventDefault();
    const ip = formIp.trim();
    const alias = formAlias.trim();
    if (!ip || !alias) return;

    const targets = applyToAll || !multiInstance ? instances : instances.filter((i) => i.id === instanceId);
    if (targets.length === 0) return;

    setFormError(null);
    setFormSaving(true);
    try {
      const results = await Promise.allSettled(targets.map((i) => api.createAlias(i.id, ip, alias)));
      const failureMessage = describeFailures(targets, results);
      if (failureMessage) {
        setFormError(`Saved on ${targets.length - (results.filter((r) => r.status === "rejected").length)}/${targets.length} instance(s). ${failureMessage}`);
      } else {
        setFormIp("");
        setFormAlias("");
      }
      await refresh();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setFormSaving(false);
    }
  }

  async function removeEntry(a) {
    const key = entryKey(a);
    patchRow(key, { deleting: true, error: null });
    try {
      await api.deleteAlias(a.instance_id, a.ip_address);
      await refresh();
    } catch (err) {
      patchRow(key, { error: err.message, deleting: false });
    }
  }

  async function removeGroup(group) {
    const key = `group::${group.ip_address}`;
    patchRow(key, { deleting: true, error: null });
    try {
      const results = await Promise.allSettled(
        group.entries.map((a) => api.deleteAlias(a.instance_id, a.ip_address))
      );
      const failureMessage = describeFailures(
        group.entries.map((a) => ({ name: a.instance_name })),
        results
      );
      if (failureMessage) patchRow(key, { error: failureMessage });
      await refresh();
    } finally {
      patchRow(key, { deleting: false });
    }
  }

  function toggleExpanded(ip) {
    setExpanded((prev) => ({ ...prev, [ip]: !prev[ip] }));
  }

  return (
    <Layout
      title="Aliases"
      headerExtra={
        <RefreshButton onClick={refresh} />
      }
    >
      <p className="mb-4 text-xs text-slate-400 dark:text-slate-500">
        Give a friendly name to viewers that show up by IP address (e.g. when an instance has LDAP disabled). An
        alias means the same thing everywhere, but each instance stores its own copy — this saves it to every
        instance at once by default, and the underlying IP is still what's actually used to identify the viewer.
      </p>

      <Card className="p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Add alias</h2>
        {prefillIp && (
          <p className="mb-3 text-xs text-accent-600 dark:text-accent-400">
            Adding an alias for {prefillIp} — pick a name below.
          </p>
        )}
        <form onSubmit={submitAlias} className="flex flex-wrap items-end gap-3">
          {multiInstance && !applyToAll && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Instance</label>
              <Select
                value={instanceId}
                onChange={setFormInstanceId}
                options={instances.map((i) => ({ value: i.id, label: i.name }))}
              />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">IP address</label>
            <input
              type="text"
              placeholder="203.0.113.42"
              value={formIp}
              onChange={(e) => setFormIp(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500 dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Alias</label>
            <input
              type="text"
              placeholder="Living room TV"
              maxLength={64}
              autoFocus={!!prefillIp}
              value={formAlias}
              onChange={(e) => setFormAlias(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500 dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <Button
            tone="default"
            loading={formSaving}
            disabled={!formIp.trim() || !formAlias.trim() || (multiInstance && !applyToAll && !instanceId)}
            onClick={submitAlias}
          >
            <IconTag className="h-3.5 w-3.5" />
            Save alias
          </Button>
        </form>
        {multiInstance && (
          <label className="mt-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <input
              type="checkbox"
              checked={applyToAll}
              onChange={(e) => setApplyToAll(e.target.checked)}
              className="rounded border-slate-300 text-accent-600 focus:ring-accent-500 dark:border-slate-600"
            />
            Apply to all {instances.length} instances
          </label>
        )}
        {formError && (
          <div className="mt-3">
            <ErrorNote message={formError} />
          </div>
        )}
      </Card>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <input
          type="search"
          placeholder="Search IP, alias, or instance…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-xs rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500 dark:border-slate-700 dark:bg-slate-900"
        />
        <PollStatus updatedAt={updatedAt} />
      </div>

      {error && (
        <div className="mt-2">
          <ErrorNote message={`Refresh failed: ${error}`} />
        </div>
      )}
      {data?.errors?.length > 0 && (
        <div className="mt-2 space-y-1">
          {data.errors.map((e) => (
            <ErrorNote key={e.instanceId} message={`${e.instanceName}: ${e.error}`} />
          ))}
        </div>
      )}

      <div className="mt-4">
        {loading && !data ? (
          <Skeleton className="h-64" />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No aliases configured"
            subtitle="Add one above to give a friendly name to a viewer that currently shows up by IP address."
          />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">IP address</th>
                    <th className="px-4 py-2.5 font-medium">Alias</th>
                    <th className="px-4 py-2.5 font-medium">Instances</th>
                    <th className="px-4 py-2.5 font-medium">Updated</th>
                    <th className="px-4 py-2.5 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filtered.map((g) => {
                    const groupState = rowState[`group::${g.ip_address}`] || {};
                    const isOpen = !!expanded[g.ip_address];
                    return (
                      <Fragment key={g.ip_address}>
                        <tr
                          className={`transition-opacity duration-150 ${
                            groupState.deleting ? "opacity-40" : "opacity-100"
                          }`}
                        >
                          <td className="px-4 py-2.5 font-mono text-xs text-slate-600 dark:text-slate-300">
                            {g.ip_address}
                          </td>
                          <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-100">
                            {g.mixed ? (
                              <Badge tone="amber">Mixed across instances</Badge>
                            ) : (
                              <Badge tone="accent">{g.alias}</Badge>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            {g.entries.length > 1 ? (
                              <button
                                onClick={() => toggleExpanded(g.ip_address)}
                                className="flex items-center gap-1 text-xs font-medium text-accent-600 hover:underline dark:text-accent-400"
                              >
                                <IconChevronDown
                                  className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
                                />
                                {g.entries.length} instance{g.entries.length === 1 ? "" : "s"}
                              </button>
                            ) : (
                              <span className="text-slate-500 dark:text-slate-400">{g.entries[0].instance_name}</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-slate-500 dark:text-slate-400">
                            {formatDateTime(g.updatedAt)}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              onClick={() => removeGroup(g)}
                              disabled={groupState.deleting}
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-rose-900/20 dark:hover:text-rose-400"
                              aria-label={`Remove alias for ${g.ip_address} everywhere`}
                            >
                              <IconTrash className="h-4 w-4" />
                            </button>
                            {groupState.error && (
                              <p className="mt-1 text-xs text-rose-500 dark:text-rose-400">{groupState.error}</p>
                            )}
                          </td>
                        </tr>
                        {isOpen &&
                          g.entries.map((a) => {
                            const key = entryKey(a);
                            const state = rowState[key] || {};
                            return (
                              <tr
                                key={key}
                                className={`bg-slate-50/60 transition-opacity duration-150 dark:bg-slate-800/30 ${
                                  state.deleting ? "opacity-40" : "opacity-100"
                                }`}
                              >
                                <td className="px-4 py-2 pl-8 text-xs text-slate-400 dark:text-slate-500" colSpan={2}>
                                  <Badge tone="slate">{a.alias}</Badge>
                                </td>
                                <td className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400">
                                  {a.instance_name}
                                </td>
                                <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-400 dark:text-slate-500">
                                  {formatDateTime(a.updated_at)}
                                </td>
                                <td className="px-4 py-2 text-right">
                                  <button
                                    onClick={() => removeEntry(a)}
                                    disabled={state.deleting}
                                    className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-rose-900/20 dark:hover:text-rose-400"
                                    aria-label={`Remove alias for ${a.ip_address} on ${a.instance_name}`}
                                  >
                                    <IconTrash className="h-3.5 w-3.5" />
                                  </button>
                                  {state.error && (
                                    <p className="mt-1 text-xs text-rose-500 dark:text-rose-400">{state.error}</p>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </Layout>
  );
}
