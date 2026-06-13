export type ToolPermission = "allow" | "ask" | "deny";

export type ToolPermissionPolicy = Record<string, ToolPermission>;

export const DEFAULT_TOOL_PERMISSION_POLICY: ToolPermissionPolicy = {
  // Read-only/introspection tools are safe by default.
  read_file: "allow",
  list_dir: "allow",
  glob: "allow",
  grep: "allow",
  http_fetch: "allow",
  task_create: "allow",
  task_list: "allow",
  task_get: "allow",
  task_update: "allow",
  present_plan: "allow",
  graph_query: "allow",
  graph_overview: "allow",
  ask_user: "allow",

  // Side-effecting tools ask by default.
  write_file: "ask",
  edit_file: "ask",
  apply_patch: "ask",
  exec: "ask",
  PowerShell: "ask",
  project_memory: "ask",
  // Delegation writes through the sub-agent, so confirm before spawning.
  spawn_agent: "ask",

  // Conservative fallback for future/custom tools.
  "*": "ask",
};

export function resolveToolPermission(
  policy: ToolPermissionPolicy | undefined,
  toolName: string,
  readonly = false,
): ToolPermission {
  // Backward-compatible programmatic default: if no policy is supplied, the
  // agent behaves as it did before this permission layer. The CLI passes the
  // resolved DEFAULT_TOOL_PERMISSION_POLICY explicitly for safer interactive use.
  if (!policy) return "allow";

  const effective = policy;
  const exact = effective[toolName];
  if (exact) return exact;

  let best: { pattern: string; permission: ToolPermission } | undefined;
  for (const [pattern, permission] of Object.entries(effective)) {
    if (!pattern.includes("*")) continue;
    if (!matchesWildcard(pattern, toolName)) continue;
    if (!best || pattern.length > best.pattern.length) {
      best = { pattern, permission };
    }
  }
  if (best) return best.permission;

  return readonly ? "allow" : "ask";
}

export function parseToolPermissionPolicyEnv(
  value: string | undefined,
): ToolPermissionPolicy | undefined {
  if (!value?.trim()) return undefined;
  const policy: ToolPermissionPolicy = {};
  for (const rawEntry of value.split(",")) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    const separator = entry.includes(":") ? ":" : "=";
    const [rawPattern, rawPermission, ...rest] = entry.split(separator);
    if (!rawPattern || !rawPermission || rest.length > 0) {
      throw new Error(`Invalid LUCKY_TOOL_PERMISSIONS entry: ${entry}`);
    }
    const permission = rawPermission.trim();
    if (!isToolPermission(permission)) {
      throw new Error(`Invalid tool permission '${permission}' for pattern '${rawPattern.trim()}'.`);
    }
    policy[rawPattern.trim()] = permission;
  }
  return Object.keys(policy).length > 0 ? policy : undefined;
}

// Leading `VAR=value` env assignments to skip when finding a command's prefix,
// so `NODE_ENV=prod npm run build` still resolves to `npm run`.
const ENV_VAR_ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

// Programs whose mode is selected by a SHORT FLAG rather than a word
// subcommand: `python -m`, `node -e`, `go -…`. For these, the flag is treated
// as the subcommand so `python -m py_compile a.py` and `…b.py` share one scope.
// Everything else (ls, cat, rm) requires a word subcommand, so a bare flag like
// `-la`/`-rf` never broadens into a prefix rule.
const FLAG_SUBCOMMAND_PROGRAMS = new Set([
  "python",
  "python3",
  "node",
  "go",
  "cargo",
  "deno",
  "bun",
  "ruby",
]);

/**
 * Extract a stable "command + subcommand" prefix from a shell command, used to
 * remember an "always" approval at a useful granularity instead of the exact
 * string. Ported from Claude Code's getSimpleCommandPrefix.
 *
 *   "git status -s"            → "git status"
 *   "NODE_ENV=prod npm run x"  → "npm run"
 *   "python -m py_compile a"   → "python -m"  (python is flag-selected)
 *   "ls -la"                   → null  (bare flag, not a subcommand)
 *   "cat file.txt"             → null  (filename, not a subcommand)
 *
 * Returns null when there's no clear subcommand, so the caller falls back to an
 * exact match — never broadening a bare `ls`/`cat`/`rm` into a prefix rule.
 * The subcommand token must be a lowercase word (git style) OR — only for the
 * flag-selected programs above — a single short flag like `-m`/`-e`.
 */
export function commandPrefix(command: string): string | null {
  const tokens = command.trim().split(/\s+/).filter(Boolean);

  // Skip leading env-var assignments.
  let i = 0;
  while (i < tokens.length && ENV_VAR_ASSIGN_RE.test(tokens[i]!)) i++;

  const remaining = tokens.slice(i);
  if (remaining.length < 2) return null;

  const program = remaining[0]!;
  // The program must be a bare command name (git, npm, python), not a path
  // (./deploy.sh, /usr/bin/x): a script invoked by path takes positional args,
  // not subcommands, so `./deploy.sh staging` must not auto-allow
  // `./deploy.sh production`.
  if (/[/.]/.test(program)) return null;

  const subcmd = remaining[1]!;
  const isWordSubcommand = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(subcmd);
  const isFlagSubcommand =
    FLAG_SUBCOMMAND_PROGRAMS.has(program) && /^-[a-z]{1,3}$/i.test(subcmd);
  if (!isWordSubcommand && !isFlagSubcommand) return null;

  return remaining.slice(0, 2).join(" ");
}

export function matchesWildcard(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`).test(value);
}

function isToolPermission(value: string): value is ToolPermission {
  return value === "allow" || value === "ask" || value === "deny";
}
