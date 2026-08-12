/**
 * The unified provider+model roster an editor picks from.
 *
 * ACP has a single model selector (`SessionModelState` + `session/set_model`),
 * not a provider picker plus a model picker, so LuckyCLI's two-dimensional
 * choice is flattened into one list of `provider/model` ids. That id is what
 * comes back in `session/set_model`, and it carries everything needed to
 * rebuild the session runtime.
 *
 * Only providers whose credentials actually resolve are offered: an editor
 * cannot run LuckyCLI's OAuth flows, so advertising a provider the user has
 * never logged into would produce a picker entry that always fails. The
 * active provider is listed first — editors show the roster in order.
 */
import {
  PROVIDER_CATALOG,
  PROVIDER_IDS,
  isBaseUrlProvider,
  isProviderId,
  resolveCredentials,
  type ProviderCredentials,
  type ProviderId,
  type StoredConfig,
} from "@luckycli/core";
import type { ModelInfo } from "@zed-industries/agent-client-protocol";

/** A roster id parsed back into its two halves. */
export interface ParsedModelId {
  provider: ProviderId;
  model: string;
}

/** `claude/claude-sonnet-5` — the id an editor round-trips through set_model. */
export function toModelId(provider: ProviderId, model: string): string {
  return `${provider}/${model}`;
}

/**
 * Parse a roster id. Model ids may themselves contain slashes (openrouter's
 * `anthropic/claude-sonnet-4`), so only the FIRST segment is the provider and
 * the rest is the model verbatim.
 */
export function parseModelId(modelId: string): ParsedModelId | undefined {
  const separator = modelId.indexOf("/");
  if (separator <= 0) return undefined;
  const provider = modelId.slice(0, separator);
  const model = modelId.slice(separator + 1);
  if (!model || !isProviderId(provider)) return undefined;
  return { provider, model };
}

/**
 * Providers with resolvable credentials (stored config or environment).
 *
 * Base-URL providers are the exception: `resolveCredentials` always succeeds
 * for them by falling back to a hardcoded localhost URL, so listing them
 * unconditionally would fill the editor's picker with entries pointing at
 * daemons that are probably not running. They are offered only when the user
 * configured them explicitly — stored credentials, or a base URL in the env.
 */
export function usableProviders(
  stored: StoredConfig,
  env: NodeJS.ProcessEnv = process.env,
): { provider: ProviderId; credentials: ProviderCredentials }[] {
  const out: { provider: ProviderId; credentials: ProviderCredentials }[] = [];
  for (const provider of PROVIDER_IDS) {
    if (isBaseUrlProvider(provider) && !isExplicitlyConfigured(provider, stored, env)) continue;
    const credentials = resolveCredentials(provider, stored, env);
    if (credentials) out.push({ provider, credentials });
  }
  return out;
}

/** Env vars that count as deliberately pointing a base-URL provider somewhere. */
const BASE_URL_ENV_VARS: Partial<Record<ProviderId, string[]>> = {
  ollama: ["OLLAMA_BASE_URL"],
  llamacpp: ["LLAMACPP_BASE_URL", "LLAMACPP_API_KEY"],
  vllm: ["VLLM_BASE_URL", "VLLM_API_KEY"],
  "openai-compatible": ["OPENAI_COMPATIBLE_BASE_URL", "OPENAI_COMPATIBLE_API_KEY"],
};

function isExplicitlyConfigured(
  provider: ProviderId,
  stored: StoredConfig,
  env: NodeJS.ProcessEnv,
): boolean {
  if (stored.credentials?.[provider]) return true;
  return (BASE_URL_ENV_VARS[provider] ?? []).some((name) => Boolean(env[name]));
}

/**
 * The roster to advertise, with the active provider's models first. `active`
 * is the session's current provider/model; its id is always present even when
 * the model is not in the static catalog (a locally served model, a slug the
 * user pinned by hand), so `currentModelId` always resolves.
 */
export function modelRoster(
  stored: StoredConfig,
  active: { provider: ProviderId; model: string } | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { availableModels: ModelInfo[]; currentModelId?: string } {
  const usable = usableProviders(stored, env);
  // The active provider leads the list; the rest keep catalog order.
  const ordered = active
    ? [
        ...usable.filter((entry) => entry.provider === active.provider),
        ...usable.filter((entry) => entry.provider !== active.provider),
      ]
    : usable;

  const availableModels: ModelInfo[] = [];
  const seen = new Set<string>();
  const push = (provider: ProviderId, model: string) => {
    const modelId = toModelId(provider, model);
    if (seen.has(modelId)) return;
    seen.add(modelId);
    availableModels.push({
      modelId,
      name: `${PROVIDER_CATALOG[provider].displayName} · ${model}`,
    });
  };

  for (const { provider } of ordered) {
    // The active model goes first within its own provider, and is included
    // even when the catalog doesn't know it.
    if (active && provider === active.provider) push(provider, active.model);
    for (const model of PROVIDER_CATALOG[provider].availableModels) push(provider, model);
  }

  return {
    availableModels,
    ...(active ? { currentModelId: toModelId(active.provider, active.model) } : {}),
  };
}

/**
 * Whether a roster id is one this agent will accept in `session/set_model`.
 * Base-URL providers (Ollama, vLLM, …) serve whatever model the user loaded,
 * so any non-empty model id is accepted for them — the same permissiveness
 * the TUI's model validation applies.
 */
export function isSelectableModel(
  parsed: ParsedModelId,
  stored: StoredConfig,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  // Same gate as the roster, so nothing selectable is ever absent from the
  // list the editor was shown (and vice versa).
  const usable = usableProviders(stored, env).some((entry) => entry.provider === parsed.provider);
  if (!usable) return false;
  if (isBaseUrlProvider(parsed.provider)) return true;
  return PROVIDER_CATALOG[parsed.provider].availableModels.includes(parsed.model);
}
