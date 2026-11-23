import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { StoredConfig } from "../config/store.js";
import { isMcpServerConfig, type McpServerConfig } from "./types.js";

/** The cross-client project MCP file (Claude Code, Cursor and others read it). */
export const PROJECT_MCP_FILE = ".mcp.json";

/**
 * Convert one `.mcp.json` entry to lucky's shape:
 *   { "command": "npx", "args": [...], "env": {...} }           -> local
 *   { "type": "http" | "sse", "url": "...", "headers": {...} }   -> remote
 * Entries already in lucky's own shape pass through; anything else is dropped.
 */
export function fromMcpJsonEntry(entry: unknown): McpServerConfig | undefined {
  if (isMcpServerConfig(entry)) return entry;
  if (!entry || typeof entry !== "object") return undefined;
  const e = entry as {
    type?: unknown;
    command?: unknown;
    args?: unknown;
    env?: unknown;
    url?: unknown;
    headers?: unknown;
    disabled?: unknown;
  };
  const declaredType = typeof e.type === "string" ? e.type.toLowerCase() : undefined;
  // `websocket`, `sdk` and the other client-specific transports have no
  // equivalent here; ignore them instead of guessing a URL/command.
  if (declaredType && !SUPPORTED_MCP_JSON_TYPES.has(declaredType)) return undefined;
  const strings = (value: unknown): Record<string, string> | undefined =>
    value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).filter((pair): pair is [string, string] => typeof pair[1] === "string"))
      : undefined;
  const enabled = e.disabled === true ? { enabled: false } : {};
  const wantsUrl =
    declaredType === "http" || declaredType === "sse" || declaredType === "streamable-http" ||
    declaredType === "remote";
  if (!wantsUrl && typeof e.command === "string") {
    const args = Array.isArray(e.args) ? e.args.filter((a): a is string => typeof a === "string") : [];
    const environment = strings(e.env);
    return {
      type: "local",
      command: [e.command, ...args],
      ...(environment && Object.keys(environment).length > 0 ? { environment } : {}),
      ...enabled,
    };
  }
  if (typeof e.url === "string") {
    const headers = strings(e.headers);
    return {
      type: "remote",
      url: e.url,
      ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
      ...enabled,
    };
  }
  return undefined;
}

/** `type` values other clients use that map onto a transport lucky supports. */
const SUPPORTED_MCP_JSON_TYPES = new Set([
  "stdio",
  "local",
  "http",
  "sse",
  "streamable-http",
  "streamable_http",
  "remote",
]);

/** Servers declared in the project's `.mcp.json`.
 *
 * Accepts both the wrapped `{ "mcpServers": { … } }` shape and the bare map
 * (`{ "name": { … } }`) some plugin bundles use. `$schema` and other metadata
 * keys are ignored by the per-entry conversion.
 */
export function loadProjectMcpJson(cwd: string): Record<string, McpServerConfig> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(cwd, PROJECT_MCP_FILE), "utf8"));
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const object = raw as Record<string, unknown>;
  const wrapped = object.mcpServers;
  const servers = wrapped && typeof wrapped === "object" && !Array.isArray(wrapped) ? wrapped : object;
  const result: Record<string, McpServerConfig> = {};
  for (const [name, entry] of Object.entries(servers)) {
    if (name === "$schema" || name === "mcpServers") continue;
    const server = fromMcpJsonEntry(entry);
    if (server) result[name] = server;
  }
  return result;
}

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

export const MCP_ADD_USAGE =
  "lucky mcp add <name> [--env KEY=VALUE]... [--] <command> [args...]\n" +
  "lucky mcp add <name> <https://url> [--header 'Name: value']...";

/**
 * Parse `mcp add` arguments into a server entry. A URL makes a remote server,
 * anything else is the command line of a local one. Options come before the
 * command; `--` ends them, so the command's own flags pass through untouched.
 */
export function parseMcpAddArgs(
  args: readonly string[],
): { name: string; server: McpServerConfig } | { error: string } {
  const [name, ...rest] = args;
  if (!name || name.startsWith("-")) return { error: `Usage: ${MCP_ADD_USAGE}` };
  const environment: Record<string, string> = {};
  const headers: Record<string, string> = {};
  let i = 0;
  while (i < rest.length) {
    const token = rest[i]!;
    if (token === "--") {
      i++;
      break;
    }
    if (token === "--env" || token === "-e") {
      const pair = rest[i + 1] ?? "";
      const eq = pair.indexOf("=");
      if (eq <= 0) return { error: `--env expects KEY=VALUE, got "${pair}".` };
      environment[pair.slice(0, eq)] = pair.slice(eq + 1);
      i += 2;
      continue;
    }
    if (token === "--header" || token === "-H") {
      const pair = rest[i + 1] ?? "";
      const colon = pair.indexOf(":");
      if (colon <= 0) return { error: `--header expects 'Name: value', got "${pair}".` };
      headers[pair.slice(0, colon).trim()] = pair.slice(colon + 1).trim();
      i += 2;
      continue;
    }
    break;
  }
  const target = rest.slice(i);
  if (target.length === 0) return { error: `Usage: ${MCP_ADD_USAGE}` };
  if (target.length === 1 && /^https?:\/\//i.test(target[0]!)) {
    if (Object.keys(environment).length > 0) return { error: "--env applies to local servers only." };
    return {
      name,
      server: {
        type: "remote",
        url: target[0]!,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      },
    };
  }
  if (Object.keys(headers).length > 0) return { error: "--header applies to remote servers only." };
  return {
    name,
    server: {
      type: "local",
      command: target,
      ...(Object.keys(environment).length > 0 ? { environment } : {}),
    },
  };
}
