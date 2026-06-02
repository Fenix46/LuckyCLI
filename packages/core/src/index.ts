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
  projectMemoryTool,
  graphQueryTool,
  graphOverviewTool,
  askUserTool,
} from "./tools/builtin/index.js";

export {
  PROJECT_MEMORY_DIR,
  PROJECT_MEMORY_FILE,
  appendProjectMemory,
  appendProjectMemoryToSystemPrompt,
  ensureProjectMemoryFile,
  projectMemoryPath,
  replaceProjectMemory,
} from "./project-memory.js";
export type { ProjectMemory } from "./project-memory.js";

// Native knowledge graph (schema + on-disk store).
export {
  CONFIDENCES,
  GRAPH_FORMAT_VERSION,
  KNOWN_RELATIONS,
  NODE_KINDS,
  assertValidGraph,
  emptyGraph,
  makeNodeId,
  parseGraph,
  validateGraph,
} from "./graph/types.js";
export type {
  Confidence,
  Extraction,
  Graph,
  GraphEdge,
  GraphMeta,
  GraphNode,
  NodeKind,
} from "./graph/types.js";
export {
  extractorFor,
  goExtractor,
  javascriptExtractor,
  pythonExtractor,
  rustExtractor,
  tsxExtractor,
  typescriptExtractor,
} from "./graph/extract/index.js";
export type { Extractor, ExtractorContext } from "./graph/extract/types.js";
export { buildAndSaveGraph, buildGraph } from "./graph/build.js";
export type { BuildOptions, BuildProgress, GraphBuildSummary } from "./graph/build.js";
export { updateGraphForFiles } from "./graph/update.js";
export type { UpdateSummary } from "./graph/update.js";
export {
  callersOf,
  calleesOf,
  godNodes,
  neighborsOf,
  resolveNodes,
  summarize,
  topModules,
} from "./graph/query.js";
export type { GraphOverview, Neighbor, RankedNode } from "./graph/query.js";
export {
  GRAPH_DIR,
  GRAPH_FILE,
  edgesFrom,
  edgesTo,
  findNodesByLabel,
  getNode,
  graphDirPath,
  graphFilePath,
  loadGraph,
  nodesInFile,
  saveGraph,
  tryLoadGraph,
} from "./graph/store.js";

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
export type { ProjectRecord, StoredConfig } from "./config/store.js";
export {
  getProjectRecord,
  isProjectTrusted,
  needsTrustPrompt,
  projectKey,
  projectNeedsTrustPrompt,
  recordGraphBuilt,
  recordProjectTrust,
  withGraphBuilt,
  withProjectTrust,
} from "./config/project-trust.js";

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
  startAntigravityOAuthFlow,
  refreshAccessToken,
  refreshAntigravityAccessToken,
  openBrowser,
} from "./providers/impl/gemini/GoogleAuthHelper.js";
