/**
 * Environment expansion for MCP server configs.
 *
 * `.mcp.json` files written for other clients routinely contain `${VAR}` and
 * `${VAR:-default}` in commands, arguments, URLs and headers. Expanding them
 * once, at config-resolution time, means every consumer (the manager, the
 * `mcp list`/`status` commands, the panels) sees the same concrete config while
 * the file on disk keeps its placeholders.
 *
 * Only the documented forms are recognized; a bare `$VAR` is left untouched so
 * shell fragments a server needs are not rewritten by accident.
 */
import type { McpServerConfig } from "./types.js";

type Env = NodeJS.ProcessEnv;

const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

/** Expand `${VAR}` and `${VAR:-default}` in a single string. */
export function expandEnvString(value: string, env: Env = process.env): string {
  if (!value.includes("${")) return value;
  return value.replace(PLACEHOLDER, (_match, name: string, fallback: string | undefined) => {
    const current = env[name];
    if (current !== undefined) return current;
    return fallback ?? "";
  });
}

function expandRecord(record: Record<string, string>, env: Env): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, expandEnvString(value, env)]),
  );
}

/** Expand every field of a server config that can contain a placeholder. */
export function expandMcpServerConfig(
  config: McpServerConfig,
  env: Env = process.env,
): McpServerConfig {
  if (config.type === "local") {
    return {
      ...config,
      command: config.command.map((part) => expandEnvString(part, env)),
      ...(config.environment ? { environment: expandRecord(config.environment, env) } : {}),
    };
  }
  if (config.type === "unix") {
    return { ...config, path: expandEnvString(config.path, env) };
  }
  return {
    ...config,
    url: expandEnvString(config.url, env),
    ...(config.headers ? { headers: expandRecord(config.headers, env) } : {}),
  };
}

/** Expand a whole server map, preserving keys. */
export function expandMcpServers(
  servers: Record<string, McpServerConfig>,
  env: Env = process.env,
): Record<string, McpServerConfig> {
  return Object.fromEntries(
    Object.entries(servers).map(([name, config]) => [name, expandMcpServerConfig(config, env)]),
  );
}
