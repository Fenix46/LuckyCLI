import {
  PROVIDER_CATALOG,
  fetchLlamaCppContextWindow,
  fetchOllamaModels,
  fetchOpenAiCompatibleModels,
  fetchOpenRouterModels,
  fetchOpencodeZenModels,
  fetchOpencodeZenContextWindows,
  fetchVllmContextWindow,
  isBaseUrlProvider,
  type ProviderId,
} from "@luckycli/core";

/** A model as reported by a discovery endpoint. */
export interface DiscoveredModel {
  id: string;
  contextWindow?: number;
}

/** The network calls used for discovery, injectable so tests stay offline. */
export interface DiscoveryDeps {
  fetchOpenRouterModels: typeof fetchOpenRouterModels;
  fetchOpencodeZenModels: typeof fetchOpencodeZenModels;
  fetchOpencodeZenContextWindows: typeof fetchOpencodeZenContextWindows;
  fetchOllamaModels: typeof fetchOllamaModels;
  fetchOpenAiCompatibleModels: typeof fetchOpenAiCompatibleModels;
  fetchLlamaCppContextWindow: typeof fetchLlamaCppContextWindow;
  fetchVllmContextWindow: typeof fetchVllmContextWindow;
}

const defaultDeps: DiscoveryDeps = {
  fetchOpenRouterModels,
  fetchOpencodeZenModels,
  fetchOpencodeZenContextWindows,
  fetchOllamaModels,
  fetchOpenAiCompatibleModels,
  fetchLlamaCppContextWindow,
  fetchVllmContextWindow,
};

/** The two secrets the discovery endpoints may need. */
export interface DiscoveryInput {
  /** API key for gateways, base URL for baseUrl providers. */
  secret: string;
  /** Second secret: API key for baseUrl providers that need one. */
  apiKeySecret: string;
}

/**
 * Pick the model-discovery call for a provider, or `null` when the provider has
 * a static catalog (or none at all) and nothing should be fetched.
 *
 * /v1/models for OpenAI-compatible servers, /api/tags for Ollama, and each
 * gateway's own /models for OpenRouter / opencode Zen. For gateways `secret`
 * holds the API key (not a base URL); the endpoint is fixed.
 */
export function selectModelDiscovery(
  provider: ProviderId | null,
  input: DiscoveryInput,
  deps: DiscoveryDeps = defaultDeps,
): (() => Promise<DiscoveredModel[]>) | null {
  if (!provider) return null;
  const key = input.secret.trim() || undefined;

  if (provider === "openrouter") {
    return () => deps.fetchOpenRouterModels(input.secret.trim());
  }

  if (provider === "opencode-zen") {
    // zen's /models has no context window; merge it from models.dev so the
    // selected model still gets a window. Falls back to the public key in core.
    return async () => {
      const [models, windows] = await Promise.all([
        deps.fetchOpencodeZenModels(key),
        deps.fetchOpencodeZenContextWindows(),
      ]);
      return models.map((m) => ({
        id: m.id,
        ...(windows[m.id] ? { contextWindow: windows[m.id] } : {}),
      }));
    };
  }

  if (isBaseUrlProvider(provider)) {
    if (PROVIDER_CATALOG[provider].availableModels.length > 0) return null;
    const url = input.secret.trim();
    const baseKey = input.apiKeySecret.trim() || undefined;
    return provider === "ollama"
      ? () => deps.fetchOllamaModels(url)
      : () => deps.fetchOpenAiCompatibleModels(url, baseKey);
  }

  return null;
}

/**
 * Pick the context-window probe for a provider that exposes one (llama.cpp,
 * vLLM), or `null` when the value has to be typed by hand.
 */
export function selectContextWindowDiscovery(
  provider: ProviderId | null,
  input: DiscoveryInput,
  deps: DiscoveryDeps = defaultDeps,
): (() => Promise<number | undefined>) | null {
  if (!provider) return null;
  const url = input.secret.trim();
  const key = input.apiKeySecret.trim() || undefined;
  if (provider === "llamacpp") return () => deps.fetchLlamaCppContextWindow(url);
  if (provider === "vllm") return () => deps.fetchVllmContextWindow(url, key);
  return null;
}

/** The state the model step derives from a completed discovery. */
export interface ModelDiscoveryOutcome {
  modelIds: string[];
  contextByModel: Record<string, number>;
  /** Set only when there is exactly one model, to preselect it. */
  preselectedModel?: string;
}

/** Reduce discovered models into the ids + per-model context windows to store. */
export function toModelDiscoveryOutcome(models: DiscoveredModel[]): ModelDiscoveryOutcome {
  const contextByModel: Record<string, number> = {};
  for (const m of models) {
    if (typeof m.contextWindow === "number" && m.contextWindow > 0) {
      contextByModel[m.id] = m.contextWindow;
    }
  }
  const only = models.length === 1 ? models[0] : undefined;
  return {
    modelIds: models.map((m) => m.id),
    contextByModel,
    ...(only ? { preselectedModel: only.id } : {}),
  };
}
