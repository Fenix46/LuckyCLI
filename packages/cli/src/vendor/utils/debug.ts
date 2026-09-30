/**
 * SHIM — minimal stand-in for Claude Code's src/utils/debug.ts.
 * The vendored Ink fork uses only `logForDebugging`. The original wrote to a
 * debug log file with filtering; here it's gated on LUCKY_DEBUG_TUI / DEBUG and
 * goes to stderr, so it never interferes with the alternate-screen TUI.
 */
import { formatWithOptions } from "node:util";

const enabled =
  process.env.LUCKY_DEBUG_TUI === "1" || process.env.DEBUG?.includes("ink");

export function logForDebugging(...args: unknown[]): void {
  if (!enabled) return;
  // Write to the stream, never via console.error: Ink patches the console to
  // route through these shims, so going through console would recurse forever.
  process.stderr.write(`[tui] ${formatWithOptions({ colors: false }, ...args)}\n`);
}
