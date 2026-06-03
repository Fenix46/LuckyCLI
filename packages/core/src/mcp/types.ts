/**
 * Core MCP domain types.
 *
 * This module is intentionally runtime-light: no SDK imports and no transport
 * logic. It defines the stable shapes the rest of Lucky will use for config,
 * lifecycle state, and metadata flowing out of MCP servers.
 */

export interface McpLocalServerConfig {
  type: "local";
  command: string[];
  environment?: Record<string, string>;
  enabled?: boolean;
  timeout?: number;
}

export interface McpRemoteServerConfig {
  type: "remote";
  url: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  timeout?: number;
}

export type McpServerConfig = McpLocalServerConfig | McpRemoteServerConfig;

export type McpConnectionStatus =
  | { status: "connected" }
  | { status: "disabled" }
  | { status: "failed"; error: string };

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpPromptDescriptor {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface McpResourceDescriptor {
  name: string;
  uri: string;
  description?: string;
  mimeType?: string;
}

export function isMcpServerConfig(value: unknown): value is McpServerConfig {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<McpServerConfig>;
  if (candidate.type === "local") {
    return Array.isArray(candidate.command) && candidate.command.every((part) => typeof part === "string");
  }
  if (candidate.type === "remote") {
    return typeof candidate.url === "string";
  }
  return false;
}
