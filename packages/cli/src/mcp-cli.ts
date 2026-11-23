/**
 * Headless `lucky mcp` subcommands. These print and exit without the TUI, so
 * MCP config and live runtime status are inspectable from scripts and CI.
 */

import { readFileSync } from "node:fs";
import {
  McpManager,
  MCP_ADD_JSON_USAGE,
  authorizeMcpServer,
  clearMcpAuthEntry,
  loadStoredConfig,
  parseMcpAddArgs,
  parseMcpAddJsonArgs,
  parseMcpJsonServer,
  planMcpImport,
  resolveConfig,
  saveStoredConfig,
  withMcpServer,
  withoutMcpServer,
  type ImportableMcpServer,
  type McpConnectionStatus,
  type McpImportPlan,
  type McpImportSource,
  type McpPromptDescriptor,
  type McpResourceDescriptor,
  type McpServerConfig,
} from "@luckycli/core";
import { APP_VERSION } from "./ui/components/constants.js";

export interface McpCommandIO {
  /** Configured servers. Defaults to the resolved Lucky config. */
  mcp?: Record<string, McpServerConfig>;
  out?: (line: string) => void;
  err?: (line: string) => void;
  /** Global config access for add/remove, injectable for tests. */
  loadConfig?: typeof loadStoredConfig;
  saveConfig?: typeof saveStoredConfig;
  /** Servers read from other clients, injectable for tests. */
  importServers?: () => ImportableMcpServer[];
  /** Text readers for add-json; injectable for tests. */
  readFile?: (path: string) => string;
  readStdin?: () => string;
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
  capabilityCounts: Record<string, { prompts: number; resources: number }> = {},
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
          ? formatCapabilityCounts(toolCounts[name] ?? 0, capabilityCounts[name])
          : "";
    return `${name.padEnd(width)}  ${entry.status.padEnd(12)}  ${detail}`.trimEnd();
  });
}

function formatCapabilityCounts(
  tools: number,
  capabilities: { prompts: number; resources: number } | undefined,
): string {
  if (!capabilities) return `${tools} tools`;
  return `${tools} tools · ${capabilities.prompts} prompts · ${capabilities.resources} resources`;
}

/** Lines for `lucky mcp inspect` — live prompts/resources for one server. */
export function mcpInspectLines(
  name: string,
  prompts: McpPromptDescriptor[],
  resources: McpResourceDescriptor[],
): string[] {
  const lines = [`${name}  connected`, "prompts:"];
  if (prompts.length === 0) {
    lines.push("  (none)");
  } else {
    for (const prompt of prompts) {
      lines.push(`  ${prompt.name}${prompt.description ? `  ${prompt.description}` : ""}`);
    }
  }
  lines.push("resources:");
  if (resources.length === 0) {
    lines.push("  (none)");
  } else {
    for (const resource of resources) {
      const metadata = [resource.uri, resource.mimeType].filter(Boolean).join("  ");
      lines.push(`  ${resource.name}  ${metadata}`.trimEnd());
    }
  }
  return lines;
}

/** Parsed `mcp import` options. */
export interface McpImportArgs {
  from: McpImportSource;
  dryRun: boolean;
  enable: boolean;
  force: boolean;
  error?: string;
}

export function parseMcpImportArgs(args: string[]): McpImportArgs {
  const result: McpImportArgs = { from: "all", dryRun: false, enable: false, force: false };
  const sources: McpImportSource[] = ["all", "claude", "claude-desktop", "cursor"];
  let i = 0;
  while (i < args.length) {
    const token = args[i]!;
    if (token === "--dry-run") {
      result.dryRun = true;
      i++;
      continue;
    }
    if (token === "--enable") {
      result.enable = true;
      i++;
      continue;
    }
    if (token === "--force") {
      result.force = true;
      i++;
      continue;
    }
    if (token === "--from" || token.startsWith("--from=")) {
      const equals = token.indexOf("=");
      const value = equals !== -1 ? token.slice(equals + 1) : args[i + 1];
      if (!value) return { ...result, error: "--from expects claude, claude-desktop, cursor or all." };
      if (!sources.includes(value as McpImportSource)) {
        return { ...result, error: `Unknown source "${value}". Use claude, claude-desktop, cursor or all.` };
      }
      result.from = value as McpImportSource;
      i += equals !== -1 ? 1 : 2;
      continue;
    }
    return { ...result, error: `Unknown option: ${token}` };
  }
  return result;
}

/** Lines describing an import plan, shared by the dry run and the real run. */
export function mcpImportLines(plan: McpImportPlan, args: Pick<McpImportArgs, "dryRun" | "enable">): string[] {
  const lines: string[] = [];
  if (plan.imported.length === 0) {
    lines.push("No MCP servers to import from other clients.");
  } else {
    const count = `${plan.imported.length} MCP server${plan.imported.length === 1 ? "" : "s"}`;
    const state = args.dryRun ? ":" : args.enable ? " (enabled):" : " (disabled; enable them from /mcp):";
    lines.push(`${args.dryRun ? "Would import" : "Imported"} ${count}${state}`);
    for (const server of plan.imported) {
      const target =
        server.config.type === "local" ? server.config.command.join(" ") : server.config.url;
      lines.push(`  ${server.name}  ${server.origin}  ${target}`);
    }
  }
  if (plan.skipped.length > 0) {
    lines.push(`Skipped existing (use --force to overwrite): ${plan.skipped.join(", ")}`);
  }
  return lines;
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

  if (sub === "add") {
    const parsed = parseMcpAddArgs(args.slice(1));
    if ("error" in parsed) {
      err(parsed.error);
      return 1;
    }
    const load = io.loadConfig ?? loadStoredConfig;
    const save = io.saveConfig ?? saveStoredConfig;
    const existed = Boolean(load().mcp?.[parsed.name]);
    save(withMcpServer(load(), parsed.name, parsed.server));
    const target = parsed.server.type === "local" ? parsed.server.command.join(" ") : parsed.server.url;
    out(`${existed ? "Updated" : "Added"} MCP server "${parsed.name}" (${parsed.server.type}): ${target}`);
    out(`Check it with: lucky mcp status`);
    return 0;
  }

  if (sub === "add-json") {
    const parsed = parseMcpAddJsonArgs(args.slice(1));
    if ("error" in parsed) {
      err(parsed.error);
      return 1;
    }
    let text: string;
    try {
      text =
        "json" in parsed
          ? parsed.json
          : parsed.file === "-"
            ? (io.readStdin ?? (() => readFileSync(0, "utf8")))()
            : (io.readFile ?? ((path: string) => readFileSync(path, "utf8")))(parsed.file);
    } catch (error) {
      err(`Unable to read the server JSON: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
    const result = parseMcpJsonServer(text);
    if ("error" in result) {
      err(result.error);
      return 1;
    }
    const load = io.loadConfig ?? loadStoredConfig;
    const save = io.saveConfig ?? saveStoredConfig;
    const existed = Boolean(load().mcp?.[parsed.name]);
    save(withMcpServer(load(), parsed.name, result.server));
    const target =
      result.server.type === "local" ? result.server.command.join(" ") : result.server.url;
    out(`${existed ? "Updated" : "Added"} MCP server "${parsed.name}" (${result.server.type}): ${target}`);
    return 0;
  }

  if (sub === "import") {
    const flags = parseMcpImportArgs(args.slice(1));
    if (flags.error) {
      err(flags.error);
      return 1;
    }
    const load = io.loadConfig ?? loadStoredConfig;
    const save = io.saveConfig ?? saveStoredConfig;
    const cfg = load();
    const plan = planMcpImport(cfg.mcp ?? {}, {
      from: flags.from,
      enable: flags.enable,
      force: flags.force,
      ...(io.importServers ? { servers: io.importServers() } : {}),
    });
    if (!flags.dryRun && plan.imported.length > 0) {
      save({ ...cfg, mcp: plan.mcp });
    }
    mcpImportLines(plan, flags).forEach(out);
    return 0;
  }

  if (sub === "remove") {
    const name = args[1];
    if (!name) {
      err("Usage: lucky mcp remove <server-name>");
      return 1;
    }
    const load = io.loadConfig ?? loadStoredConfig;
    const save = io.saveConfig ?? saveStoredConfig;
    const cfg = load();
    if (!cfg.mcp?.[name]) {
      err(`No MCP server named "${name}" in your global config.`);
      return 1;
    }
    save(withoutMcpServer(cfg, name));
    out(`Removed MCP server "${name}".`);
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

  if (sub === "inspect") {
    const name = args[1];
    if (!name) {
      err("Usage: lucky mcp inspect <server-name>");
      return 1;
    }
    const server = mcp[name];
    if (!server) {
      err(`No MCP server named "${name}" is configured.`);
      return 1;
    }
    const manager = new McpManager({ clientName: "lucky", clientVersion: APP_VERSION });
    try {
      const status = await manager.connectServer(name, server);
      if (status.status !== "connected") {
        err(
          status.status === "failed"
            ? `Unable to inspect ${name}: ${status.error}`
            : `Unable to inspect ${name}: server is ${status.status}.`,
        );
        return 1;
      }
      const [prompts, resources] = await Promise.all([
        manager.listPrompts(name),
        manager.listResources(name),
      ]);
      mcpInspectLines(name, prompts, resources).forEach(out);
      return 0;
    } catch (error) {
      err(`Unable to inspect ${name}: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    } finally {
      await manager.close();
    }
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
      const capabilityEntries = await Promise.all(
        Object.entries(status)
          .filter(([, entry]) => entry.status === "connected")
          .map(async ([name]) => {
            const [prompts, resources] = await Promise.all([
              manager.listPrompts(name).catch(() => []),
              manager.listResources(name).catch(() => []),
            ]);
            return [name, { prompts: prompts.length, resources: resources.length }] as const;
          }),
      );
      mcpStatusLines(status, toolCounts, Object.fromEntries(capabilityEntries)).forEach(out);
      return 0;
    } finally {
      await manager.close();
    }
  }

  err(`Unknown mcp command "${sub}". Usage: lucky mcp list|status|inspect|login|logout`);
  return 1;
}
