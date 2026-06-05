/**
 * SHIM — minimal stand-in for Claude Code's src/utils/envUtils.ts.
 * The vendored Ink fork only uses `isEnvTruthy`; the original also carried
 * Anthropic-specific helpers (AWS/Vertex region, teams dir) we don't need.
 */
export function isEnvTruthy(envVar: string | boolean | undefined): boolean {
  if (!envVar) return false;
  if (typeof envVar === "boolean") return envVar;
  const normalizedValue = envVar.toLowerCase().trim();
  return ["1", "true", "yes", "on"].includes(normalizedValue);
}
