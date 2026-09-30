/**
 * Session approval scoping, shared by the TUI (Root's approveTool bridge) and
 * the ACP server so "always" means the same thing on every surface.
 */
import {
  commandPrefix,
  evaluateCommand,
  loadStoredConfig,
  mergeCommandRules,
  parseCommandRulesEnv,
  type CommandRules,
  type CommandVerdict,
} from "@luckycli/core";

/** Tools auto-approved while a session is in "accept edits" mode. */
export const AUTO_ACCEPT_EDIT_TOOLS: ReadonlySet<string> = new Set([
  "write_file",
  "edit_file",
  "apply_patch",
]);

/** Shell tools whose commands go through the per-command policy. */
const SHELL_TOOLS: ReadonlySet<string> = new Set(["exec", "PowerShell"]);

function shellCommand(name: string, input: unknown): string | undefined {
  if (!SHELL_TOOLS.has(name)) return undefined;
  const command = (input as { command?: unknown } | null)?.command;
  return typeof command === "string" ? command.trim() : undefined;
}

/**
 * The user's command rules: `commandRules` in ~/.luckycli/config.json plus
 * LUCKY_COMMAND_RULES. Read on every call, so edits apply without a restart.
 * A malformed environment value is ignored rather than breaking approvals.
 */
export function loadCommandRules(env: NodeJS.ProcessEnv = process.env): CommandRules {
  let fromEnv: CommandRules = {};
  try {
    fromEnv = parseCommandRulesEnv(env.LUCKY_COMMAND_RULES);
  } catch {
    // reported by /rules; approvals keep working with the stored rules
  }
  let stored: CommandRules | undefined;
  try {
    stored = loadStoredConfig().commandRules;
  } catch {
    stored = undefined;
  }
  return mergeCommandRules(stored, fromEnv);
}

/**
 * The per-command verdict for a shell call, or undefined for other tools.
 * A call that opts into `allowDangerous` always needs a human yes: the shell
 * tools refuse destructive commands unless it is set, and the flag is meant
 * to follow an explicit approval — no mode or rule grants it on the user's
 * behalf (deny rules still block it outright).
 */
export function shellCommandVerdict(
  name: string,
  input: unknown,
  cwd: string,
  rules: CommandRules,
): CommandVerdict | undefined {
  const command = shellCommand(name, input);
  if (command === undefined) return undefined;
  const verdict = evaluateCommand(command, cwd, rules);
  const dangerous = (input as { allowDangerous?: unknown } | null)?.allowDangerous === true;
  if (dangerous && verdict.action !== "deny") {
    return { action: "ask", reason: verdict.reason ?? "runs a command the shell tool flags as destructive", byRule: false };
  }
  return verdict;
}

/**
 * Whether a call must still ask the user while the session is in "auto" mode:
 * shell commands the policy flags (pushes, publishes, deploys, remote
 * scripts, destructive commands and scripts that run them, or your `ask`
 * rules). Everything else is auto-approved.
 */
export function requiresApprovalInAutoMode(verdict: CommandVerdict | undefined): boolean {
  return verdict?.action === "ask";
}

/**
 * The scope at which an "always" approval is remembered for the session.
 *
 *  - exec: remember the command + subcommand PREFIX (e.g. "git status",
 *    "python -m"), so re-running it with different flags or file arguments is
 *    auto-allowed and only a different command/subcommand asks again. Commands
 *    with no clear subcommand (ls, cat, rm) fall back to the exact string, so
 *    they're never broadened into a prefix rule.
 *  - a shell command the policy flags as risky: the exact command only, so
 *    approving `git push origin main` never approves `git push --force`, and
 *    approving `npm run test` (prefix "npm run") never approves a risky
 *    `npm run deploy`.
 *  - every other ask-level tool (write_file, edit_file, apply_patch, …):
 *    remember the whole tool, so approving once stops the re-prompts.
 */
export function approvalScope(name: string, input: unknown, risky = false): string {
  const command = shellCommand(name, input);
  if (command !== undefined) {
    if (risky) return `${name}:exact:${command}`;
    if (name === "exec") {
      const prefix = commandPrefix(command);
      return prefix ? `exec:${prefix}` : `exec:${command}`;
    }
  }
  return name;
}

/**
 * What choosing "always" will remember, in the words shown on the approval
 * prompt — so the user knows how far the approval reaches.
 */
export function describeAlwaysScope(name: string, input: unknown, risky = false): string {
  const scope = approvalScope(name, input, risky);
  const command = shellCommand(name, input);
  if (command !== undefined && scope.includes(":exact:")) {
    return "Don't ask again for this exact command this session";
  }
  if (name === "exec" && scope.startsWith("exec:")) {
    const remembered = scope.slice("exec:".length);
    return remembered === command
      ? "Don't ask again for this exact command this session"
      : `Don't ask again for \`${remembered}\` commands this session`;
  }
  return `Don't ask again for ${name} this session`;
}
