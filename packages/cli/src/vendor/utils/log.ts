/**
 * SHIM — minimal stand-in for Claude Code's src/utils/log.ts.
 * The vendored Ink fork uses only `logError`. The original shipped errors to
 * telemetry; here it's a stderr write gated to avoid corrupting the TUI screen.
 */
import { formatWithOptions } from "node:util";

const enabled =
  process.env.LUCKY_DEBUG_TUI === "1" || process.env.DEBUG?.includes("ink");

export function logError(error: unknown): void {
  if (!enabled) return;
  // Write to the stream, never via console.error: Ink patches console.error to
  // route through logError, so going through console would recurse forever.
  process.stderr.write(`[tui:error] ${formatWithOptions({ colors: false }, error)}\n`);
}
