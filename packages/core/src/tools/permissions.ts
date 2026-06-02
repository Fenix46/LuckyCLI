export type ToolPermission = "allow" | "ask" | "deny";

export type ToolPermissionPolicy = Record<string, ToolPermission>;

export const DEFAULT_TOOL_PERMISSION_POLICY: ToolPermissionPolicy = {
  // Read-only/introspection tools are safe by default.
  read_file: "allow",
  list_dir: "allow",
  glob: "allow",
  grep: "allow",
  http_fetch: "allow",
  todo_write: "allow",
  ask_user: "allow",

  // Side-effecting tools ask by default.
  write_file: "ask",
  edit_file: "ask",
  apply_patch: "ask",
  exec: "ask",
  PowerShell: "ask",

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
