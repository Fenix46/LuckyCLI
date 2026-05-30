/**
 * @luckycli/core — the provider-agnostic agent engine.
 *
 * Importing this module registers all built-in providers, so the public API is
 * ready to use: load config, build credentials, get a provider, run the Agent.
 */

// Provider layer (also triggers built-in provider registration on import).
export * from "./providers/index.js";

// Agent loop.
export { Agent } from "./agent/agent.js";
export type { AgentConfig } from "./agent/agent.js";
export type { AgentEvent } from "./agent/types.js";

// Tools.
export { ToolRegistry } from "./tools/registry.js";
export { defineTool } from "./tools/types.js";
export type { Tool, ToolContext, ToolResult } from "./tools/types.js";
export {
  defaultToolRegistry,
  execTool,
  readFileTool,
  writeFileTool,
} from "./tools/builtin/index.js";

// Configuration.
export {
  credentialsFromEnv,
  loadConfig,
} from "./config/config.js";
export type { AppConfig, CliOverrides } from "./config/config.js";
