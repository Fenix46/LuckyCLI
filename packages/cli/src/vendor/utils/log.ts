/**
 * SHIM — minimal stand-in for Claude Code's src/utils/log.ts.
 * The vendored Ink fork uses only `logError`. The original shipped errors to
 * telemetry; here it's a stderr write gated to avoid corrupting the TUI screen.
 */
const enabled =
  process.env.LUCKY_DEBUG_TUI === "1" || process.env.DEBUG?.includes("ink");

export function logError(error: unknown): void {
  if (!enabled) return;
  // eslint-disable-next-line no-console
  console.error("[tui:error]", error);
}
