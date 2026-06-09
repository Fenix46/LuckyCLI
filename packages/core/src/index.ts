/**
 * @luckycli/core — the provider-agnostic agent engine.
 *
 * Importing this module registers all built-in providers, so the public API is
 * ready to use: load config, build credentials, get a provider, run the Agent.
 */

// Package version (single source of truth: core's package.json).
export { CORE_VERSION } from "./version.js";

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
export type {
  AskUserRequest,
  SpawnAgentRequest,
  SpawnAgentResult,
  Tool,
  ToolContext,
  ToolResult,
  ToolResultMetadata,
} from "./tools/types.js";
export { diffLines, fileDiff } from "./diff.js";
export type { DiffHunk, DiffLine, FileDiff } from "./diff.js";
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
  taskCreateTool,
  taskListTool,
  taskGetTool,
  taskUpdateTool,
  presentPlanTool,
  spawnAgentTool,
  projectMemoryTool,
  graphQueryTool,
  graphOverviewTool,
  askUserTool,
} from "./tools/builtin/index.js";
export type { PlanProposal, PlanDecision, PlanTask } from "./agent/plan.js";

// Sub-agents.
export {
  AgentProfileSchema,
  agentsRootDir,
  deleteProfile,
  getProfile,
  listProfiles,
  sanitizeProfileName,
  saveProfile,
  seedDefaultProfiles,
} from "./agents/profiles.js";
export type { AgentProfile, NewAgentProfile } from "./agents/profiles.js";
export { runSubAgent } from "./agents/runner.js";
export type { SubAgentRequest, SubAgentResult } from "./agents/runner.js";

export {
  TASK_STATUSES,
  TaskSchema,
  TaskStatusSchema,
  cleanupOrphanTaskLists,
  createTask,
  deleteTask,
  getActiveTaskListId,
  getTask,
  listTasks,
  onTasksUpdated,
  resetTaskList,
  sanitizePathComponent,
  setActiveTaskListId,
  tasksDirFor,
  tasksRootDir,
  updateTask,
} from "./tasks/store.js";
export type { NewTask, Task, TaskStatus } from "./tasks/store.js";

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
  cExtractor,
  cppExtractor,
  csharpExtractor,
  dartExtractor,
  extractorFor,
  goExtractor,
  htmlExtractor,
  javaExtractor,
  javascriptExtractor,
  jsonExtractor,
  kotlinExtractor,
  phpExtractor,
  pythonExtractor,
  rubyExtractor,
  rustExtractor,
  swiftExtractor,
  tomlExtractor,
  tsxExtractor,
  typescriptExtractor,
} from "./graph/extract/index.js";
export type { Extractor, ExtractorContext } from "./graph/extract/types.js";
export { buildAndSaveGraph, buildGraph } from "./graph/build.js";
export type { BuildOptions, BuildProgress, GraphBuildSummary } from "./graph/build.js";
export { updateGraphForFiles } from "./graph/update.js";
export type { UpdateSummary } from "./graph/update.js";
export {
  diffSnapshots,
  snapshotFiles,
  trackedGraphFiles,
} from "./graph/fs-snapshot.js";
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
export { renderGraphHtml } from "./graph/view.js";
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
  buildSystemPromptFromContext,
  buildSummarizationPrompt,
  renderEnvironment,
  resolveSections,
  defineSection,
  SYSTEM_PROMPT_SECTIONS,
  IDENTITY_PROMPT,
  AGENCY_PROMPT,
  TOOL_USE_PROMPT,
  ENVIRONMENT_PROMPT_TEMPLATE,
  SUMMARIZATION_PROMPT,
} from "./prompts/index.js";
export type { EnvironmentInfo, PromptContext, PromptSection } from "./prompts/index.js";

// Persistent config store.
export {
  DEFAULT_REASONING_EFFORT,
  DEFAULT_THINKING_ENABLED,
  configFilePath,
  getReasoningEffort,
  getThinkingEnabled,
  loadStoredConfig,
  saveProviderSetup,
  saveReasoningEffort,
  saveThinkingEnabled,
  saveStoredConfig,
} from "./config/store.js";
export type {
  AutoUpdatePolicy,
  ProjectRecord,
  StagedUpdate,
  StoredConfig,
} from "./config/store.js";

// Self-update machinery.
export { compareVersions, versionLabel } from "./update/versions.js";
export {
  clearStagedUpdate,
  getAutoUpdatePolicy,
  withAutoUpdatePolicy,
  withStagedUpdate,
} from "./update/policy.js";
export { applyStagedUpdateIfAny } from "./update/startup.js";
export type { StagedApplyResult } from "./update/startup.js";
export {
  assetName,
  buildAssetUrls,
  canSelfUpdate,
  cleanupStaleBinary,
  detectSelfUpdate,
  downloadVerified,
  isCompiledBinary,
  isDirWritable,
  parseSha256Sums,
  resolvePlatform,
  swapInPlace,
} from "./update/self-replace.js";
export type {
  AssetUrls,
  DownloadDeps,
  LuckyArch,
  LuckyOs,
  SelfUpdateCapability,
} from "./update/self-replace.js";
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

// MCP domain types.
export {
  normalizeMcpServers,
  withMcpServer,
  withoutMcpServer,
} from "./mcp/config.js";
export {
  adaptMcpTool,
  makeMcpToolName,
} from "./mcp/tool-adapter.js";
export { McpLocalClient } from "./mcp/local-client.js";
export { McpRemoteClient } from "./mcp/remote-client.js";
export type { McpClient } from "./mcp/client.js";
export { McpManager } from "./mcp/manager.js";
export type { McpManagerOptions } from "./mcp/manager.js";
export { McpOAuthProvider, nonInteractiveMcpOAuthProvider } from "./mcp/oauth-provider.js";
export type { McpOAuthProviderOptions } from "./mcp/oauth-provider.js";
export { startOAuthCallbackServer } from "./mcp/oauth-callback.js";
export type { OAuthCallbackResult, OAuthCallbackServer } from "./mcp/oauth-callback.js";
export { authorizeMcpServer } from "./mcp/oauth-flow.js";
export type { AuthorizeMcpResult, AuthorizeMcpServerOptions } from "./mcp/oauth-flow.js";
export {
  clearMcpAuthEntry,
  getMcpAuthEntry,
  loadMcpAuthStore,
  mcpAuthFilePath,
  saveMcpAuthStore,
  updateMcpAuthEntry,
} from "./mcp/auth-store.js";
export type { McpAuthEntry, McpAuthStore } from "./mcp/auth-store.js";
export {
  isMcpServerConfig,
} from "./mcp/types.js";
export type {
  McpConnectionStatus,
  McpLocalServerConfig,
  McpPromptDescriptor,
  McpRemoteServerConfig,
  McpResourceDescriptor,
  McpServerConfig,
  McpToolDescriptor,
} from "./mcp/types.js";

// MCP catalog.
export { OfficialMcpRegistryCatalog } from "./mcp-catalog/official.js";
export {
  CachedMcpCatalog,
  catalogCacheFilePath,
  isEntryFresh,
  loadCatalogCache,
  saveCatalogCache,
} from "./mcp-catalog/cache.js";
export type {
  CachedCatalogEntry,
  McpCatalogCacheData,
  McpCatalogSource,
} from "./mcp-catalog/cache.js";
export {
  catalogDetailToPreset,
  presetToStoredMcpConfig,
} from "./mcp-catalog/presets.js";
export type {
  CatalogPackage,
  CatalogRemote,
  CatalogSearchResult,
  CatalogServerDetail,
  CatalogServerSummary,
  LuckyMcpPreset,
} from "./mcp-catalog/types.js";
