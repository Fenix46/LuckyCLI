/**
 * Headless `lucky mcp` subcommands. These print and exit without the TUI, so
 * MCP config and live runtime status are inspectable from scripts and CI.
 */

import {
  McpManager,
  resolveConfig,
  type McpConnectionStatus,
  type McpServerConfig,
} from "@luckycli/core";

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

  if (sub === "status" || sub === "doctor") {
    if (Object.keys(mcp).length === 0) {
      out("No MCP servers configured.");
      return 0;
    }
    const manager = new McpManager({ clientName: "lucky", clientVersion: "0.2.0" });
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

  err(`Unknown mcp command "${sub}". Usage: lucky mcp list|status`);
  return 1;
}
