/**
 * Session approval scoping, shared by the TUI (Root's approveTool bridge) and
 * the ACP server so "always" means the same thing on every surface.
 */
import { commandPrefix } from "@luckycli/core";

/** Tools auto-approved while a session is in "accept edits" mode. */
export const AUTO_ACCEPT_EDIT_TOOLS: ReadonlySet<string> = new Set([
  "write_file",
  "edit_file",
  "apply_patch",
]);

/**
 * The scope at which an "always" approval is remembered for the session.
 *
 * Previously this keyed on the exact, full tool input, so "always" only ever
 * matched an identical call again — a write to a different file, or any change
 * in arguments, would re-prompt. We instead remember at a useful granularity,
 * mirroring how other coding agents work:
 *
 *  - exec: remember the command + subcommand PREFIX (e.g. "git status",
 *    "python -m"), so re-running it with different flags or file arguments is
 *    auto-allowed and only a different command/subcommand asks again. Commands
 *    with no clear subcommand (ls, cat, rm) fall back to the exact string, so
 *    they're never broadened into a prefix rule.
 *  - every other ask-level tool (write_file, edit_file, apply_patch, …):
 *    remember the whole tool, so approving once stops the re-prompts.
 */
export function approvalScope(name: string, input: unknown): string {
  if (name === "exec") {
    const command = (input as { command?: unknown } | null)?.command;
    if (typeof command === "string") {
      const prefix = commandPrefix(command);
      return prefix ? `exec:${prefix}` : `exec:${command.trim()}`;
    }
  }
  return name;
}
