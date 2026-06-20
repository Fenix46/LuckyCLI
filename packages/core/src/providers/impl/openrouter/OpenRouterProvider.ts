/**
 * OpenRouter provider — an OpenAI-compatible aggregator that fronts many
 * vendors behind one API key. We reuse the OpenAI Chat Completions adapter and
 * only fix the base URL plus OpenRouter's attribution headers; the model id is
 * namespaced (`vendor/model`) and forwarded verbatim.
 */

import { providerInfo } from "../../catalog.js";
import { withContextWindow } from "../../model-info.js";
import type {
  ModelInfo,
  OpenRouterCredentials,
  ProviderInfo,
} from "../../types.js";
import { fetchOpenRouterModels } from "../openai-models.js";
import { OpenAiProvider } from "../openai/OpenAiProvider.js";

/** OpenRouter's OpenAI-compatible endpoint. */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Attribution headers OpenRouter uses to identify the calling app. Optional for
 * the API to work, but recommended so usage shows up under lucky.
 */
const OPENROUTER_HEADERS: Record<string, string> = {
  "HTTP-Referer": "https://github.com/luckycli",
  "X-Title": "lucky",
};

export class OpenRouterProvider extends OpenAiProvider {
  override readonly info: ProviderInfo;
  private readonly apiKey: string;

  constructor(credentials: OpenRouterCredentials) {
    super({
      type: "openai",
      apiKey: credentials.apiKey,
      baseUrl: OPENROUTER_BASE_URL,
      extraHeaders: OPENROUTER_HEADERS,
    });
    this.apiKey = credentials.apiKey;
    // Model ids are live, namespaced slugs absent from the static catalog and
    // each has its own context window. A saved credentials.contextWindow is
    // only an immediate hint for the active model; the authoritative per-model
    // windows are loaded below from /models.
    const seeded = withContextWindow(
      providerInfo("openrouter"),
      credentials.contextWindow,
    );
    // Mutable own `models` map we fill in place; the agent re-reads
    // provider.info.models on every context check, so the async fill is used.
    this.info = { ...seeded, models: { ...(seeded.models ?? {}) } };
    void this.preloadModelWindows();
  }

  /**
   * Fetch every model's context window from OpenRouter's /models and merge it
   * into `info.models`, so currentModelInfo() resolves the right window for ANY
   * model the user selects. Best effort: failures leave the map untouched.
   */
  private async preloadModelWindows(): Promise<void> {
    const models = this.info.models as Record<string, ModelInfo>;
    for (const m of await fetchOpenRouterModels(this.apiKey)) {
      if (typeof m.contextWindow !== "number" || m.contextWindow <= 0) continue;
      models[m.id] = { ...(models[m.id] ?? { id: m.id }), id: m.id, contextWindow: m.contextWindow };
    }
  }
}
