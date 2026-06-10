import { existsSync } from "node:fs";
import {
  Agent,
  McpManager,
  appendProjectMemoryToSystemPrompt,
  buildSystemPromptFromContext,
  defaultToolRegistry,
  ensureProjectMemoryFile,
  getProvider,
  graphFilePath,
  hasInstalledSkills,
  listProfiles,
  SkillActivator,
  nonInteractiveMcpOAuthProvider,
  resetProvider,
  updateGraphForFiles,
  type AskUserRequest,
  type PlanProposal,
  type PlanDecision,
  type SpawnAgentRequest,
  type SpawnAgentResult,
  type Message,
  type McpServerConfig,
  type ProviderCredentials,
  type ProviderId,
  type ToolApproval,
  type Tool,
  type ToolPermissionPolicy,
} from "@luckycli/core";
import { APP_VERSION } from "./ui/components/constants.js";

/**
 * Loopback redirect used when a stored token needs refreshing in the background.
 * It is only ever exercised during interactive login (see `lucky mcp login`),
 * where a real ephemeral port is used; here it's a placeholder because the
 * non-interactive provider refuses to launch a browser.
 */
const MCP_OAUTH_REDIRECT = "http://127.0.0.1:7632/mcp/callback";

/**
 * A debounced graph maintainer: file tools report changes via onFilesChanged,
 * and shortly after the last change we re-extract just those files into the
 * existing graph. No-ops when the project has no graph yet, so it's free until
 * the user opts in. This is what keeps the graph current autonomously — the
 * model never has to remember to refresh it.
 */
function createGraphMaintainer(cwd: string): (paths: string[]) => void {
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (paths: string[]) => {
    for (const p of paths) pending.add(p);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const batch = [...pending];
      pending.clear();
      timer = undefined;
      void updateGraphForFiles(cwd, batch).catch(() => {
        /* graph upkeep is best-effort; never disturb the session */
      });
    }, 800);
    timer.unref?.();
  };
}

export interface BuildAgentOptions {
  provider: ProviderId;
  model: string;
  credentials: ProviderCredentials;
  system: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: string;
  thinkingEnabled?: boolean;
  permissions?: ToolPermissionPolicy;
  approveTool?: (name: string, input: unknown) => Promise<ToolApproval> | ToolApproval;
  askUser?: (request: AskUserRequest) => Promise<string>;
  presentPlan?: (plan: PlanProposal) => Promise<PlanDecision>;
  runSubAgent?: (
    request: SpawnAgentRequest,
    signal?: AbortSignal,
  ) => Promise<SpawnAgentResult>;
  extraTools?: Tool[];
  /**
   * When true, recompose the system prompt from the live session context
   * (enabled tools, whether a graph exists, whether sub-agents are configured)
   * so conditional sections react to this session. Ignored if LUCKY_SYSTEM is
   * set — a custom system prompt is always honored verbatim. Defaults to false,
   * preserving the prebuilt `system` string.
   */
  composeSystemFromContext?: boolean;
  /**
   * Pre-built tool registry to use as-is. When given, `extraTools` is ignored —
   * the caller owns the registry (e.g. to register MCP tools into it later).
   */
  toolRegistry?: RuntimeToolRegistry;
  /** Prior conversation to resume from (e.g. a loaded session). */
  messages?: Message[];
  /**
   * Session skill activator. Shared between the agent (so skill_load marks a
   * skill active) and the UI turn loop (so it augments the user turn). When
   * omitted, buildAgent creates one.
   */
  skillActivator?: SkillActivator;
}

type RuntimeToolRegistry = ReturnType<typeof defaultToolRegistry>;

/**
 * Register extra (MCP) tools into a registry, skipping any whose name is already
 * taken. Extra tools are not under our control: two servers can expose the same
 * name, a name can sanitize into a built-in's name, etc. ToolRegistry.register
 * throws on a duplicate, which would otherwise abort buildAgent and wedge the
 * session at "Starting session...". Skipping keeps the runtime up — built-ins and
 * the first server win. Returns the number of tools actually registered.
 */
export function registerExtraTools(registry: RuntimeToolRegistry, extraTools: Tool[]): number {
  let registered = 0;
  for (const tool of extraTools) {
    if (registry.has(tool.name)) continue;
    registry.register(tool);
    registered += 1;
  }
  return registered;
}

export function createRuntimeToolRegistry(extraTools: Tool[] = []) {
  const registry = defaultToolRegistry();
  registerExtraTools(registry, extraTools);
  return registry;
}

export interface BuildAgentRuntimeOptions extends BuildAgentOptions {
  mcp?: Record<string, McpServerConfig>;
  cwd?: string;
}

export interface BuiltAgentRuntime {
  agent: Agent;
  /** Session skill activator, shared with the agent (skill_load) and UI turn loop. */
  skillActivator: SkillActivator;
  mcpManager?: McpManager;
  /**
   * Resolves once the background MCP connection has settled and any tools have
   * been registered. The session does not wait on this — it's exposed so callers
   * (and tests) can observe when MCP is fully wired.
   */
  mcpReady?: Promise<void>;
}

/**
 * Construct an Agent for the given provider/model/credentials. Resets any cached
 * provider instance first so changing credentials at runtime takes effect.
 */
export function buildAgent(opts: BuildAgentOptions): Agent {
  resetProvider(opts.provider);
  const provider = getProvider(opts.provider, opts.credentials);
  const cwd = process.cwd();
  const projectMemory = ensureProjectMemoryFile(cwd);
  const tools = opts.toolRegistry ?? createRuntimeToolRegistry(opts.extraTools);
  const skillActivator = opts.skillActivator ?? new SkillActivator();

  // Optionally recompose the system prompt from this session's context so the
  // conditional sections react to it. A custom LUCKY_SYSTEM always wins, so we
  // only recompose when the prebuilt prompt is the default one.
  const composed =
    opts.composeSystemFromContext && process.env.LUCKY_SYSTEM === undefined
      ? buildSystemPromptFromContext({
          environment: {
            cwd,
            os: `${process.platform} (${process.arch})`,
            date: new Date().toISOString().slice(0, 10),
          },
          model: opts.model,
          enabledTools: new Set(tools.definitions().map((d) => d.name)),
          hasGraph: existsSync(graphFilePath(cwd)),
          hasSubAgents: listProfiles().length > 0,
          hasSkills: hasInstalledSkills(),
          env: process.env,
        })
      : opts.system;

  return new Agent({
    provider,
    model: opts.model,
    tools,
    system: appendProjectMemoryToSystemPrompt(composed, projectMemory),
    permissions: opts.permissions,
    approveTool: opts.approveTool,
    askUser: opts.askUser,
    ...(opts.presentPlan ? { presentPlan: opts.presentPlan } : {}),
    ...(opts.runSubAgent ? { runSubAgent: opts.runSubAgent } : {}),
    onFilesChanged: createGraphMaintainer(cwd),
    onSkillLoaded: (id) => skillActivator.markActive(id),
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
    ...(opts.reasoningEffort ? { reasoningEffort: opts.reasoningEffort } : {}),
    ...(opts.thinkingEnabled !== undefined ? { thinkingEnabled: opts.thinkingEnabled } : {}),
    ...(opts.messages?.length ? { messages: opts.messages } : {}),
  });
}

export async function buildAgentRuntime(
  opts: BuildAgentRuntimeOptions,
): Promise<BuiltAgentRuntime> {
  const cwd = opts.cwd ?? process.cwd();
  const mcp = opts.mcp ?? {};

  // Build the agent immediately against a registry we own. MCP servers connect
  // in the background and register their tools into this same registry as they
  // come up — the agent reads tool definitions live each turn, so late arrivals
  // are picked up without rebuilding. This keeps session startup instant even
  // when a server is slow (e.g. first-run `npx` downloads) or wedged.
  const registry = createRuntimeToolRegistry(opts.extraTools);
  const skillActivator = opts.skillActivator ?? new SkillActivator();
  const agent = buildAgent({ ...opts, toolRegistry: registry, skillActivator });

  if (Object.keys(mcp).length === 0) return { agent, skillActivator };

  const mcpManager = new McpManager({
    cwd,
    clientName: "lucky",
    clientVersion: APP_VERSION,
    // Use stored OAuth tokens (and let the SDK refresh them) for remote servers,
    // but never pop a browser mid-session: a server needing fresh login fails
    // with a clear "run lucky mcp login" message instead.
    authProviderFor: (name) =>
      nonInteractiveMcpOAuthProvider(name, { redirectUrl: MCP_OAUTH_REDIRECT }),
  });
  const mcpReady = mcpManager
    .connectAll(mcp)
    .then(() => {
      registerExtraTools(registry, mcpManager.tools());
    })
    .catch(() => {
      // Connection failures are reflected in mcpManager.status(); never let a
      // misbehaving server break the session.
    });

  return { agent, skillActivator, mcpManager, mcpReady };
}
