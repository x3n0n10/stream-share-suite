import { useMemo, useState } from "react";
import Layout from "../components/Layout.jsx";
import { Card, Badge, EmptyState, ErrorNote, Button } from "../components/common.jsx";
import { IconSearch, IconDownload, IconCopy, IconCheck, IconChevronDown } from "../components/Icons.jsx";
import { api } from "../lib/api.js";
import { titleCase } from "../lib/format.js";

function resultKey(r) {
  return `${r.instance_id}::${r.StreamType}::${r.StreamID}`;
}

// navigator.clipboard requires a secure context (https, or localhost) — this
// dashboard is routinely run over plain http on a LAN, so fall back to the
// legacy execCommand trick rather than silently failing there.
async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fall through to legacy fallback below
    }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(ta);
  }
}

// Groups the flat result list into movies (unchanged) and series, where every
// episode of the same series on the same instance collapses into one item
// that expands to reveal its episodes — stream-share's search returns one
// VODResult per episode, there's no series-level entry to key off of.
function groupResults(results) {
  const items = [];
  const seriesByKey = new Map();

  for (const r of results) {
    if (r.StreamType !== "series") {
      items.push({ kind: "movie", key: resultKey(r), result: r });
      continue;
    }
    const seriesTitle = r.SeriesTitle || r.Title;
    const groupKey = `${r.instance_id}::series::${seriesTitle}`;
    let group = seriesByKey.get(groupKey);
    if (!group) {
      group = {
        kind: "series",
        key: groupKey,
        seriesTitle,
        category: r.Category,
        year: r.Year,
        instance_id: r.instance_id,
        instance_name: r.instance_name,
        episodes: [],
      };
      seriesByKey.set(groupKey, group);
      items.push(group);
    }
    group.episodes.push(r);
  }

  for (const item of items) {
    if (item.kind === "series") {
      item.episodes.sort((a, b) => (a.Season || 0) - (b.Season || 0) || (a.Episode || 0) - (b.Episode || 0));
    }
  }

  return items;
}

// Download / Copy URL controls shared between movie cards and episode rows
// within an expanded series.
function VodActions({ result, state, onDownload, onCopy }) {
  return (
    <div className="flex items-center gap-2">
      <Button tone="ghost" loading={state.copying} onClick={() => onCopy(result)}>
        {state.copied ? <IconCheck className="h-3.5 w-3.5" /> : <IconCopy className="h-3.5 w-3.5" />}
        {state.copied ? "Copied" : "Copy URL"}
      </Button>
      <Button tone="ghost" loading={state.downloading} onClick={() => onDownload(result)}>
        <IconDownload className="h-3.5 w-3.5" />
        Download
      </Button>
    </div>
  );
}

export default function Vod() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [errors, setErrors] = useState([]);
  const [searchError, setSearchError] = useState(null);
  const [rowState, setRowState] = useState({}); // key -> { downloading, copying, copied, error }
  const [expanded, setExpanded] = useState({}); // series group key -> bool

  const items = useMemo(() => groupResults(results), [results]);

  async function runSearch(e) {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;

    setLoading(true);
    setSearchError(null);
    setRowState({});
    setExpanded({});
    try {
      const data = await api.vodSearch(q);
      setResults(data.results || []);
      setErrors(data.errors || []);
      setSubmittedQuery(q);
    } catch (err) {
      setSearchError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function patchRow(key, patch) {
    setRowState((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  async function download(result) {
    const key = resultKey(result);
    patchRow(key, { downloading: true, error: null });
    try {
      const data = await api.vodDownload(result.instance_id, result.StreamID, result.Title, result.StreamType);
      window.open(data.download_url, "_blank", "noopener");
    } catch (err) {
      patchRow(key, { error: err.message });
    } finally {
      patchRow(key, { downloading: false });
    }
  }

  async function copyUrl(result) {
    const key = resultKey(result);
    patchRow(key, { copying: true, error: null });
    try {
      const data = await api.vodDownload(result.instance_id, result.StreamID, result.Title, result.StreamType);
      await copyToClipboard(data.download_url);
      patchRow(key, { copied: true });
      setTimeout(() => patchRow(key, { copied: false }), 2000);
    } catch (err) {
      patchRow(key, { error: err.message });
    } finally {
      patchRow(key, { copying: false });
    }
  }

  function toggleExpanded(key) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <Layout title="VOD Search">
      <form onSubmit={runSearch} className="flex gap-2">
        <input
          type="search"
          autoFocus
          placeholder="Search movies and series across all instances…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full max-w-md rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500 dark:border-slate-700 dark:bg-slate-900"
        />
        <Button onClick={runSearch} loading={loading} disabled={!query.trim()}>
          <IconSearch className="h-4 w-4" />
          Search
        </Button>
      </form>

      {searchError && (
        <div className="mt-3">
          <ErrorNote message={`Search failed: ${searchError}`} />
        </div>
      )}
      {errors.length > 0 && (
        <div className="mt-3 space-y-1">
          {errors.map((e) => (
            <ErrorNote key={e.instanceId} message={`${e.instanceName}: ${e.error}`} />
          ))}
        </div>
      )}

      <div className="mt-6">
        {!submittedQuery && !loading ? (
          <EmptyState
            title="Search for a movie or series"
            subtitle="Results are pulled live from every instance that has an Xtream provider configured — nothing is indexed or stored here."
          />
        ) : loading ? (
          <EmptyState title="Searching…" />
        ) : items.length === 0 ? (
          <EmptyState title={`No results for "${submittedQuery}"`} subtitle="Try a different title or spelling." />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => {
              if (item.kind === "movie") {
                const r = item.result;
                const state = rowState[item.key] || {};
                return (
                  <Card key={item.key} className="flex flex-col p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium leading-snug text-slate-900 dark:text-white">{r.Title}</p>
                      <Badge tone="slate">{titleCase(r.StreamType)}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                      {r.Category && <span>{r.Category}</span>}
                      {r.Year && <span>{r.Year}</span>}
                      {r.Rating && <span>★ {r.Rating}</span>}
                      {r.Duration && <span>{r.Duration}</span>}
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{r.instance_name}</p>

                    {state.error && (
                      <div className="mt-2">
                        <ErrorNote message={state.error} />
                      </div>
                    )}

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <VodActions result={r} state={state} onDownload={download} onCopy={copyUrl} />
                    </div>
                  </Card>
                );
              }

              const isOpen = !!expanded[item.key];
              return (
                <Card key={item.key} className="flex flex-col p-4">
                  <button
                    onClick={() => toggleExpanded(item.key)}
                    className="flex items-start justify-between gap-2 text-left"
                  >
                    <p className="text-sm font-medium leading-snug text-slate-900 dark:text-white">
                      {item.seriesTitle}
                    </p>
                    <Badge tone="accent">Series</Badge>
                  </button>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                    {item.category && <span>{item.category}</span>}
                    {item.year && <span>{item.year}</span>}
                    <span>
                      {item.episodes.length} episode{item.episodes.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{item.instance_name}</p>

                  <button
                    onClick={() => toggleExpanded(item.key)}
                    className="mt-3 flex items-center gap-1 text-xs font-medium text-accent-600 hover:underline dark:text-accent-400"
                  >
                    <IconChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    {isOpen ? "Hide episodes" : "Show episodes"}
                  </button>

                  {isOpen && (
                    <div className="mt-3 -mx-4 max-h-80 divide-y divide-slate-100 overflow-y-auto border-t border-slate-100 px-4 dark:divide-slate-800 dark:border-slate-800">
                      {item.episodes.map((ep) => {
                        const epKey = resultKey(ep);
                        const state = rowState[epKey] || {};
                        return (
                          <div key={epKey} className="py-2.5">
                            <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                              S{String(ep.Season || 0).padStart(2, "0")}E{String(ep.Episode || 0).padStart(2, "0")}
                              {ep.EpisodeTitle ? ` — ${ep.EpisodeTitle}` : ""}
                            </p>
                            {state.error && (
                              <div className="mt-1">
                                <ErrorNote message={state.error} />
                              </div>
                            )}
                            <div className="mt-1.5">
                              <VodActions result={ep} state={state} onDownload={download} onCopy={copyUrl} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
