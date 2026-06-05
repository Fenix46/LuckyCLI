/**
 * Headless `lucky mcp` subcommands. These print and exit without the TUI, so
 * MCP config and live runtime status are inspectable from scripts and CI.
 */

import {
  McpManager,
  authorizeMcpServer,
  clearMcpAuthEntry,
  resolveConfig,
  type McpConnectionStatus,
  type McpServerConfig,
} from "@luckycli/core";
import { APP_VERSION } from "./ui/components/constants.js";

export interface McpCommandIO {
  /** Configured servers. Defaults to the resolved Lucky config. */
  mcp?: Record<string, McpServerConfig>;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

/** Lines for `lucky mcp list` — what's configured, without connecting. */
export function mcpListLines(mcp: Record<string, McpServerConfig>): string[] {
  const names = Object.keys(mcp);
  if (names.length === 0) return ["No MCP servers configured."];
  const width = Math.max(...names.map((name) => name.length));
  return names.map((name) => {
    const config = mcp[name]!;
    const enabled = config.enabled === false ? "disabled" : "enabled";
    const target = config.type === "local" ? config.command.join(" ") : config.url;
    return `${name.padEnd(width)}  ${config.type.padEnd(6)}  ${enabled.padEnd(8)}  ${target}`;
  });
}

/** Lines for `lucky mcp status` — live connection result per server. */
export function mcpStatusLines(
  status: Record<string, McpConnectionStatus>,
  toolCounts: Record<string, number>,
): string[] {
  const names = Object.keys(status);
  if (names.length === 0) return ["No MCP servers configured."];
  const width = Math.max(...names.map((name) => name.length));
  return names.map((name) => {
    const entry = status[name]!;
    const detail =
      entry.status === "failed"
        ? entry.error
        : entry.status === "connected"
          ? `${toolCounts[name] ?? 0} tools`
          : "";
    return `${name.padEnd(width)}  ${entry.status.padEnd(12)}  ${detail}`.trimEnd();
  });
}

/**
 * Run an `mcp` subcommand. Returns a process exit code. `list` reads config;
 * `status`/`doctor` actually connects to each server, reports the outcome, then
 * tears the connections down.
 */
export async function runMcpCommand(args: string[], io: McpCommandIO = {}): Promise<number> {
  const out = io.out ?? ((line) => process.stdout.write(`${line}\n`));
  const err = io.err ?? ((line) => process.stderr.write(`${line}\n`));
  const mcp = io.mcp ?? resolveConfig().mcp;
  const sub = args[0] ?? "list";

  if (sub === "list") {
    mcpListLines(mcp).forEach(out);
    return 0;
  }

  if (sub === "login" || sub === "logout") {
    const name = args[1];
    if (!name) {
      err(`Usage: lucky mcp ${sub} <server-name>`);
      return 1;
    }
    const server = mcp[name];
    if (!server) {
      err(`No MCP server named "${name}" is configured.`);
      return 1;
    }
    if (sub === "logout") {
      clearMcpAuthEntry(name);
      out(`Logged out of ${name}.`);
      return 0;
    }
    if (server.type !== "remote") {
      err(`"${name}" is a local server; OAuth login only applies to remote servers.`);
      return 1;
    }
    out(`Authorizing ${name} — a browser window will open...`);
    const result = await authorizeMcpServer({ name, url: server.url });
    out(
      result.status === "already-authorized"
        ? `${name} is already authorized.`
        : `${name} authorized.`,
    );
    return 0;
  }

  if (sub === "status" || sub === "doctor") {
    if (Object.keys(mcp).length === 0) {
      out("No MCP servers configured.");
      return 0;
    }
    const manager = new McpManager({ clientName: "lucky", clientVersion: APP_VERSION });
    try {
      const status = await manager.connectAll(mcp);
      const toolCounts = Object.fromEntries(
        Object.keys(status).map((name) => [name, manager.toolCount(name)]),
      );
      mcpStatusLines(status, toolCounts).forEach(out);
      return 0;
    } finally {
      await manager.close();
    }
  }

  err(`Unknown mcp command "${sub}". Usage: lucky mcp list|status|login|logout`);
  return 1;
}
