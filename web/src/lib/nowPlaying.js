// Instances list their streams in random order (Go map iteration), so the
// Overview sorts them itself: oldest first, with tiebreaks, so rows stay put.

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function sortNowPlaying(rows) {
  return rows
    .map((row) => {
      const t = Date.parse(row.started_at);
      return { row, t: Number.isNaN(t) ? Infinity : t };
    })
    .sort(
      (a, b) =>
        cmp(a.t, b.t) ||
        cmp(String(a.row.instanceId), String(b.row.instanceId)) ||
        cmp(a.row.stream_id, b.row.stream_id)
    )
    .map(({ row }) => row);
}
