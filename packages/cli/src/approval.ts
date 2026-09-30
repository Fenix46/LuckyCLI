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

/** Shell tools whose destructive calls stay gated even in auto mode. */
const SHELL_TOOLS: ReadonlySet<string> = new Set(["exec", "PowerShell"]);

/**
 * Whether a call must still ask the user while the session is in "auto" mode.
 *
 * Auto mode approves every ask-level tool so the agent can work unattended.
 * The one exception is a shell call that opts into `allowDangerous`: the shell
 * tools refuse destructive commands (rm, git reset --hard, force push, …)
 * unless that flag is set, and the flag is meant to follow an explicit human
 * yes — so auto mode never grants it on the user's behalf. Tools the policy
 * denies never reach the approval bridge at all.
 */
export function requiresApprovalInAutoMode(name: string, input: unknown): boolean {
  if (!SHELL_TOOLS.has(name)) return false;
  return (input as { allowDangerous?: unknown } | null)?.allowDangerous === true;
}

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

/**
 * What choosing "always" will remember, in the words shown on the approval
 * prompt — so the user knows how far the approval reaches.
 */
export function describeAlwaysScope(name: string, input: unknown): string {
  const scope = approvalScope(name, input);
  if (name === "exec" && scope.startsWith("exec:")) {
    const command = (input as { command?: unknown } | null)?.command;
    const remembered = scope.slice("exec:".length);
    return typeof command === "string" && remembered === command.trim()
      ? "Don't ask again for this exact command this session"
      : `Don't ask again for \`${remembered}\` commands this session`;
  }
  return `Don't ask again for ${name} this session`;
}
