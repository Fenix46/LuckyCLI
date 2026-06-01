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
export type { AgentConfig, ToolApproval } from "./agent/agent.js";
export type { AgentEvent, CompactionResult, ContextStatus } from "./agent/types.js";

// Tools.
export { ToolRegistry } from "./tools/registry.js";
export {
  DEFAULT_TOOL_PERMISSION_POLICY,
  matchesWildcard,
  parseToolPermissionPolicyEnv,
  resolveToolPermission,
} from "./tools/permissions.js";
export type { ToolPermission, ToolPermissionPolicy } from "./tools/permissions.js";
export { defineTool } from "./tools/types.js";
export type { AskUserRequest, Tool, ToolContext, ToolResult } from "./tools/types.js";
export {
  defaultToolRegistry,
  execTool,
  readFileTool,
  writeFileTool,
  editFileTool,
  applyPatchTool,
  listDirTool,
  globTool,
  grepTool,
  httpFetchTool,
  todoWriteTool,
  askUserTool,
} from "./tools/builtin/index.js";

// Configuration.
export {
  credentialsFromEnv,
  DEFAULT_SYSTEM_PROMPT,
  resolveConfig,
  resolveCredentials,
} from "./config/config.js";
export type { CliOverrides, ResolvedConfig } from "./config/config.js";

// Prompt assembly — composed from the section files in ./prompts.
export {
  buildSystemPrompt,
  buildSummarizationPrompt,
  renderEnvironment,
  IDENTITY_PROMPT,
  AGENCY_PROMPT,
  TOOL_USE_PROMPT,
  ENVIRONMENT_PROMPT_TEMPLATE,
  SUMMARIZATION_PROMPT,
} from "./prompts/index.js";
export type { EnvironmentInfo } from "./prompts/index.js";

// Persistent config store.
export {
  configFilePath,
  loadStoredConfig,
  saveProviderSetup,
  saveStoredConfig,
} from "./config/store.js";
export type { StoredConfig } from "./config/store.js";

// Persistent chat sessions.
export {
  createSessionId,
  deleteSession,
  deriveTitle,
  isValidSessionId,
  latestSession,
  listSessions,
  loadSession,
  saveSession,
  sessionFilePath,
  sessionsDirPath,
} from "./session/store.js";
export type { Session, SessionMeta } from "./session/store.js";

export {
  startOAuthFlow,
  refreshAccessToken,
  openBrowser,
} from "./providers/impl/gemini/GoogleAuthHelper.js";
