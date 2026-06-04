import type { StoredConfig } from "../config/store.js";
import { isMcpServerConfig, type McpServerConfig } from "./types.js";

export function normalizeMcpServers(
  value: unknown,
): Record<string, McpServerConfig> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, McpServerConfig> = {};
  for (const [name, entry] of Object.entries(value)) {
    if (isMcpServerConfig(entry)) result[name] = entry;
  }
  return result;
}

export function withMcpServer(
  cfg: StoredConfig,
  name: string,
  server: McpServerConfig,
): StoredConfig {
  return {
    ...cfg,
    mcp: {
      ...(cfg.mcp ?? {}),
      [name]: server,
    },
  };
}

export function withoutMcpServer(cfg: StoredConfig, name: string): StoredConfig {
  if (!cfg.mcp?.[name]) return cfg;
  const next = { ...(cfg.mcp ?? {}) };
  delete next[name];
  return {
    ...cfg,
    mcp: next,
  };
}
