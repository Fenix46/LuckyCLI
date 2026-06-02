import {
  Agent,
  appendProjectMemoryToSystemPrompt,
  defaultToolRegistry,
  ensureProjectMemoryFile,
  getProvider,
  resetProvider,
  type AskUserRequest,
  type Message,
  type ProviderCredentials,
  type ProviderId,
  type ToolApproval,
  type ToolPermissionPolicy,
} from "@luckycli/core";

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
  /** Prior conversation to resume from (e.g. a loaded session). */
  messages?: Message[];
}

/**
 * Construct an Agent for the given provider/model/credentials. Resets any cached
 * provider instance first so changing credentials at runtime takes effect.
 */
export function buildAgent(opts: BuildAgentOptions): Agent {
  resetProvider(opts.provider);
  const provider = getProvider(opts.provider, opts.credentials);
  const projectMemory = ensureProjectMemoryFile(process.cwd());
  return new Agent({
    provider,
    model: opts.model,
    tools: defaultToolRegistry(),
    system: appendProjectMemoryToSystemPrompt(opts.system, projectMemory),
    permissions: opts.permissions,
    approveTool: opts.approveTool,
    askUser: opts.askUser,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
    ...(opts.messages?.length ? { messages: opts.messages } : {}),
  });
}
