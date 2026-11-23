/**
 * Read MCP servers configured for other clients, so importing them is a
 * deliberate one-command action instead of hand-copying JSON.
 *
 * This module is strictly read-only: it never starts a server and never writes
 * another client's files. `collectImportableServers` returns the converted
 * configs with their origin; the CLI (`lucky mcp import`) decides what to
 * persist, and imports them disabled.
 *
 * Sources, in precedence order (first wins on a name collision):
 * - `~/.claude.json` → `mcpServers` (Claude Code user scope)
 * - `~/.claude.json` → `projects[<cwd>].mcpServers` (Claude Code local scope)
 * - Claude Desktop (`claude_desktop_config.json`)
 * - `~/.cursor/mcp.json` (Cursor user scope)
 * - `<cwd>/.cursor/mcp.json` (Cursor project scope)
 */
import { readFileSync } from "node:fs";
import { homedir, platform as currentPlatform } from "node:os";
import { join, resolve } from "node:path";
import { fromMcpJsonEntry } from "./config.js";
import type { McpServerConfig } from "./types.js";

export type McpImportOrigin = "claude" | "claude-project" | "claude-desktop" | "cursor";

export interface ImportableMcpServer {
  name: string;
  config: McpServerConfig;
  origin: McpImportOrigin;
}

/** Sources accepted by `--from`; `all` means every reader. */
export type McpImportSource = "all" | "claude" | "claude-desktop" | "cursor";

export interface CollectImportOptions {
  home?: string;
  cwd?: string;
  platform?: NodeJS.Platform;
}

export interface McpImportPlan {
  /** Servers that would be written (or are written, when not a dry run). */
  imported: ImportableMcpServer[];
  /** Existing names left untouched because `force` was not set. */
  skipped: string[];
  /** The resulting server map, existing entries preserved. */
  mcp: Record<string, McpServerConfig>;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

/** Convert a `mcpServers` map, dropping entries the runtime cannot use. */
function convertServers(
  raw: unknown,
  origin: McpImportOrigin,
): ImportableMcpServer[] {
  const servers = (raw as { mcpServers?: unknown } | undefined)?.mcpServers;
  if (!servers || typeof servers !== "object") return [];
  const out: ImportableMcpServer[] = [];
  for (const [name, entry] of Object.entries(servers)) {
    const config = fromMcpJsonEntry(entry);
    if (config) out.push({ name, config, origin });
  }
  return out;
}

/** Claude Code user-scope servers (`~/.claude.json`). */
export function readClaudeUserMcp(home = homedir()): ImportableMcpServer[] {
  return convertServers(readJson(join(home, ".claude.json")), "claude");
}

/** Claude Code local-scope servers for one folder. */
export function readClaudeProjectMcp(home = homedir(), cwd = process.cwd()): ImportableMcpServer[] {
  const raw = readJson(join(home, ".claude.json")) as
    | { projects?: Record<string, { mcpServers?: unknown }> }
    | undefined;
  const projects = raw?.projects;
  if (!projects) return [];
  const record = projects[resolve(cwd)] ?? projects[cwd];
  return convertServers(record, "claude-project");
}

/** Claude Desktop config path for the given platform. */
export function claudeDesktopConfigPath(
  home = homedir(),
  platform: NodeJS.Platform = currentPlatform(),
): string {
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (platform === "win32") {
    return join(home, "AppData", "Roaming", "Claude", "claude_desktop_config.json");
  }
  return join(home, ".config", "Claude", "claude_desktop_config.json");
}

/** Claude Desktop servers. */
export function readClaudeDesktopMcp(
  home = homedir(),
  platform: NodeJS.Platform = currentPlatform(),
): ImportableMcpServer[] {
  return convertServers(readJson(claudeDesktopConfigPath(home, platform)), "claude-desktop");
}

/** Cursor user-scope servers (`~/.cursor/mcp.json`). */
export function readCursorMcp(home = homedir()): ImportableMcpServer[] {
  return convertServers(readJson(join(home, ".cursor", "mcp.json")), "cursor");
}

/** Cursor project-scope servers (`<cwd>/.cursor/mcp.json`). */
export function readCursorProjectMcp(cwd = process.cwd()): ImportableMcpServer[] {
  return convertServers(readJson(join(cwd, ".cursor", "mcp.json")), "cursor");
}

/**
 * Every importable server, deduplicated by name with the first source winning.
 * Missing or corrupt files are skipped, never fatal.
 */
export function collectImportableServers(
  options: CollectImportOptions = {},
): ImportableMcpServer[] {
  const home = options.home ?? homedir();
  const cwd = options.cwd ?? process.cwd();
  const platform = options.platform ?? currentPlatform();

  const groups = [
    readClaudeUserMcp(home),
    readClaudeProjectMcp(home, cwd),
    readClaudeDesktopMcp(home, platform),
    readCursorMcp(home),
    readCursorProjectMcp(cwd),
  ];

  const seen = new Set<string>();
  const out: ImportableMcpServer[] = [];
  for (const group of groups) {
    for (const server of group) {
      if (seen.has(server.name)) continue;
      seen.add(server.name);
      out.push(server);
    }
  }
  return out;
}

function matchesSource(origin: McpImportOrigin, source: McpImportSource): boolean {
  if (source === "all") return true;
  if (source === "claude") return origin === "claude" || origin === "claude-project";
  return origin === source;
}

/**
 * Merge importable servers into an existing map without writing anything.
 * Existing names are skipped unless `force`; imported entries are disabled
 * unless `enable`, and carry `importedFrom` for provenance in the UI.
 */
export function planMcpImport(
  existing: Record<string, McpServerConfig>,
  options: CollectImportOptions & {
    from?: McpImportSource;
    enable?: boolean;
    force?: boolean;
    /** Pre-collected servers, for callers that already read the sources. */
    servers?: ImportableMcpServer[];
  } = {},
): McpImportPlan {
  const source = options.from ?? "all";
  const mcp: Record<string, McpServerConfig> = { ...existing };
  const imported: ImportableMcpServer[] = [];
  const skipped: string[] = [];

  for (const server of options.servers ?? collectImportableServers(options)) {
    if (!matchesSource(server.origin, source)) continue;
    if (mcp[server.name] && !options.force) {
      skipped.push(server.name);
      continue;
    }
    const config: McpServerConfig = {
      ...server.config,
      importedFrom: server.origin,
      ...(options.enable ? {} : { enabled: false }),
    };
    mcp[server.name] = config;
    imported.push(server);
  }

  return { imported, skipped, mcp };
}
