// Pure version parsing and comparison for the update check.

const COMMIT = [/^dev-([0-9a-f]{7,40})$/, /^([0-9a-f]{7,40})$/, /-g([0-9a-f]{7,40})(?:-dirty)?$/];
const RELEASE = /^(v?)(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

// A release, a commit, or null for anything that says nothing comparable.
// Commit patterns come first: `v1.0.0-3-gabc1234` also looks like a release.
export function parseVersion(text) {
  const s = String(text ?? "").trim();
  for (const re of COMMIT) {
    const m = re.exec(s);
    if (m) return { type: "commit", sha: m[1] };
  }
  const m = RELEASE.exec(s);
  if (m) return { type: "release", numbers: [m[2], m[3], m[4]].map(Number), hasV: m[1] === "v" };
  return null;
}

// True when `latest` is strictly greater than `current`; false if either
// side is not a release.
export function isNewerRelease(current, latest) {
  const a = parseVersion(current);
  const b = parseVersion(latest);
  if (a?.type !== "release" || b?.type !== "release") return false;
  for (let i = 0; i < 3; i++) {
    if (b.numbers[i] !== a.numbers[i]) return b.numbers[i] > a.numbers[i];
  }
  return false;
}
