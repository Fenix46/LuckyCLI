/**
 * Version-string math shared between the update checker and the self-replace
 * machinery. Tags follow `vMAJOR.MINOR.PATCH[-pre]`; we compare numerically and
 * tolerate a missing leading `v`.
 */

/** Compare two version strings. <0 if a<b, 0 if equal, >0 if a>b. */
export function compareVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Normalize to a `vX.Y.Z` label (adds the leading `v` if missing). */
export function versionLabel(version: string): string {
  return version.startsWith("v") ? version : `v${version}`;
}

/** Numeric components of a version, ignoring the `v` prefix and non-numerics. */
export function versionParts(version: string): number[] {
  return versionLabel(version)
    .replace(/^v/, "")
    .split(/[.-]/)
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part));
}
