/**
 * OpenRouter provider — an OpenAI-compatible aggregator that fronts many
 * vendors behind one API key. We reuse the OpenAI Chat Completions adapter and
 * only fix the base URL plus OpenRouter's attribution headers; the model id is
 * namespaced (`vendor/model`) and forwarded verbatim.
 */

import { providerInfo } from "../../catalog.js";
import type { OpenRouterCredentials, ProviderInfo } from "../../types.js";
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

  constructor(credentials: OpenRouterCredentials) {
    super({
      type: "openai",
      apiKey: credentials.apiKey,
      baseUrl: OPENROUTER_BASE_URL,
      extraHeaders: OPENROUTER_HEADERS,
    });
    this.info = providerInfo("openrouter");
  }
}
