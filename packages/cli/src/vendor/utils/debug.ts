/**
 * SHIM — minimal stand-in for Claude Code's src/utils/debug.ts.
 * The vendored Ink fork uses only `logForDebugging`. The original wrote to a
 * debug log file with filtering; here it's gated on LUCKY_DEBUG_TUI / DEBUG and
 * goes to stderr, so it never interferes with the alternate-screen TUI.
 */
const enabled =
  process.env.LUCKY_DEBUG_TUI === "1" || process.env.DEBUG?.includes("ink");

export function logForDebugging(...args: unknown[]): void {
  if (!enabled) return;
  // eslint-disable-next-line no-console
  console.error("[tui]", ...args);
}
