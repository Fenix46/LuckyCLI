/**
 * Version-string math shared between the update checker and the self-replace
 * machinery. Tags follow `vMAJOR.MINOR.PATCH[-pre]`; we compare them with
 * semver precedence and tolerate a missing leading `v`.
 */

/**
 * Compare two version strings. <0 if a<b, 0 if equal, >0 if a>b.
 *
 * Semver precedence: MAJOR.MINOR.PATCH numerically, then a release outranks
 * any of its own pre-releases (0.7.0 > 0.7.0-rc.2), and pre-release
 * identifiers compare field by field — numeric ones numerically and below
 * alphanumeric ones, a longer list winning a tie. Build metadata (+...) is
 * ignored.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    const diff = (left.core[i] ?? 0) - (right.core[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (left.pre.length === 0 || right.pre.length === 0) {
    return right.pre.length - left.pre.length;
  }
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const l = left.pre[i];
    const r = right.pre[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const diff = comparePreId(l, r);
    if (diff !== 0) return diff;
  }
  return 0;
}

function comparePreId(a: string, b: string): number {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) return Number(a) - Number(b);
  if (aNum) return -1;
  if (bNum) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function parseVersion(version: string): { core: number[]; pre: string[] } {
  const bare = version.trim().replace(/^v/, "").split("+")[0] ?? "";
  const dash = bare.indexOf("-");
  const core = (dash === -1 ? bare : bare.slice(0, dash))
    .split(".")
    .map((part) => Number(part))
    .map((part) => (Number.isFinite(part) ? part : 0));
  const pre = dash === -1 ? [] : bare.slice(dash + 1).split(".").filter(Boolean);
  return { core, pre };
}

/** Normalize to a `vX.Y.Z` label (adds the leading `v` if missing). */
export function versionLabel(version: string): string {
  const trimmed = version.trim();
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}
