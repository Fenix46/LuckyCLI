import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { isMcpServerConfig, type McpServerConfig } from "../mcp/types.js";
import type { ToolPermissionPolicy } from "../tools/permissions.js";
import type { TokenCostRates } from "../usage-cost.js";

const PermissionSchema = z.enum(["allow", "ask", "deny"]);
const TokenCostRatesSchema = z.object({
  inputPerMillion: z.number().finite().nonnegative(),
  outputPerMillion: z.number().finite().nonnegative(),
  cacheReadPerMillion: z.number().finite().nonnegative().optional(),
  cacheWritePerMillion: z.number().finite().nonnegative().optional(),
}).strict();
export const ProjectConfigSchema = z.object({
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  checks: z.array(z.string().min(1)).optional(),
  graph: z.object({ exclude: z.array(z.string().min(1)) }).strict().optional(),
  skills: z.array(z.string().min(1)).optional(),
  costs: z.record(z.string().min(1), TokenCostRatesSchema).optional(),
  mcp: z.record(z.string().min(1), z.unknown()).optional(),
  permissions: z.record(z.string().min(1), PermissionSchema).optional(),
}).strict();

export interface ProjectConfig {
  provider?: string;
  model?: string;
  checks?: string[];
  graphExclusions?: string[];
  skills?: string[];
  tokenCosts?: Record<string, TokenCostRates>;
  mcp?: Record<string, McpServerConfig>;
  permissions?: ToolPermissionPolicy;
}

/** Load and validate `.lucky/config.json` without ever exposing its contents. */
export function loadProjectConfig(cwd: string): ProjectConfig {
  const path = resolve(cwd, ".lucky", "config.json");
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, "utf8")) as unknown; } catch (error) {
    throw new Error(`invalid project config: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = ProjectConfigSchema.parse(parsed);
  const exclusions = result.graph?.exclude ?? [];
  for (const exclusion of exclusions) assertRelativePath(cwd, exclusion);
  return {
    ...(result.provider ? { provider: result.provider } : {}),
    ...(result.model ? { model: result.model } : {}),
    ...(result.checks ? { checks: result.checks } : {}),
    ...(exclusions.length ? { graphExclusions: exclusions } : {}),
    ...(result.skills ? { skills: result.skills } : {}),
    ...(result.costs ? { tokenCosts: result.costs } : {}),
    ...(result.mcp ? { mcp: parseMcp(result.mcp) } : {}),
    ...(result.permissions ? { permissions: result.permissions } : {}),
  };
}

function assertRelativePath(cwd: string, path: string): void {
  const target = resolve(cwd, path);
  const rel = relative(resolve(cwd), target);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith("..")) throw new Error(`project config path escapes root: ${path}`);
}

function parseMcp(value: Record<string, unknown>): Record<string, McpServerConfig> {
  const parsed: Record<string, McpServerConfig> = {};
  for (const [name, server] of Object.entries(value)) {
    if (!isMcpServerConfig(server)) throw new Error(`invalid MCP server config: ${name}`);
    parsed[name] = server;
  }
  return parsed;
}
