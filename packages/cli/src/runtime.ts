import {
  Agent,
  appendProjectMemoryToSystemPrompt,
  defaultToolRegistry,
  ensureProjectMemoryFile,
  getProvider,
  resetProvider,
  updateGraphForFiles,
  type AskUserRequest,
  type Message,
  type ProviderCredentials,
  type ProviderId,
  type ToolApproval,
  type Tool,
  type ToolPermissionPolicy,
} from "@luckycli/core";

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
  permissions?: ToolPermissionPolicy;
  approveTool?: (name: string, input: unknown) => Promise<ToolApproval> | ToolApproval;
  askUser?: (request: AskUserRequest) => Promise<string>;
  extraTools?: Tool[];
  /** Prior conversation to resume from (e.g. a loaded session). */
  messages?: Message[];
}

export function createRuntimeToolRegistry(extraTools: Tool[] = []) {
  const registry = defaultToolRegistry();
  for (const tool of extraTools) registry.register(tool);
  return registry;
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
  return new Agent({
    provider,
    model: opts.model,
    tools: createRuntimeToolRegistry(opts.extraTools),
    system: appendProjectMemoryToSystemPrompt(opts.system, projectMemory),
    permissions: opts.permissions,
    approveTool: opts.approveTool,
    askUser: opts.askUser,
    onFilesChanged: createGraphMaintainer(cwd),
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
    ...(opts.messages?.length ? { messages: opts.messages } : {}),
  });
}
