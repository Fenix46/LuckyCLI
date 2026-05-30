import {
  Agent,
  defaultToolRegistry,
  getProvider,
  resetProvider,
  type ProviderCredentials,
  type ProviderId,
} from "@luckycli/core";

export interface BuildAgentOptions {
  provider: ProviderId;
  model: string;
  credentials: ProviderCredentials;
  system: string;
  temperature?: number;
  maxTokens?: number;
  approveTool?: (name: string, input: unknown) => Promise<boolean> | boolean;
}

/**
 * Construct an Agent for the given provider/model/credentials. Resets any cached
 * provider instance first so changing credentials at runtime takes effect.
 */
export function buildAgent(opts: BuildAgentOptions): Agent {
  resetProvider(opts.provider);
  const provider = getProvider(opts.provider, opts.credentials);
  return new Agent({
    provider,
    model: opts.model,
    tools: defaultToolRegistry(),
    system: opts.system,
    approveTool: opts.approveTool,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
  });
}
