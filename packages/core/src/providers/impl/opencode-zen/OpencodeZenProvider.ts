/**
 * opencode Zen provider — opencode's hosted, OpenAI-compatible gateway. We reuse
 * the OpenAI Chat Completions adapter and fix the base URL plus attribution
 * header. The API key is optional: without one we fall back to the shared
 * "public" key, which opencode accepts for its free model tier.
 */

import { providerInfo } from "../../catalog.js";
import { withContextWindow } from "../../model-info.js";
import type { OpencodeZenCredentials, ProviderInfo } from "../../types.js";
import { OpenAiProvider } from "../openai/OpenAiProvider.js";

/** opencode Zen's OpenAI-compatible endpoint. */
export const OPENCODE_ZEN_BASE_URL = "https://opencode.ai/zen/v1";

/**
 * Shared key used when the user has not supplied one. Mirrors opencode's own
 * fallback (see plugin/provider/opencode.ts), which serves only free models.
 */
export const OPENCODE_ZEN_PUBLIC_KEY = "public";

export class OpencodeZenProvider extends OpenAiProvider {
  override readonly info: ProviderInfo;

  constructor(credentials: OpencodeZenCredentials) {
    super({
      type: "openai",
      apiKey: credentials.apiKey || OPENCODE_ZEN_PUBLIC_KEY,
      baseUrl: OPENCODE_ZEN_BASE_URL,
      extraHeaders: { "X-Title": "lucky" },
    });
    // The model id is not in the static catalog (it's a live id), so apply the
    // discovered window as the provider-wide default currentModelInfo() uses.
    this.info = withContextWindow(
      providerInfo("opencode-zen"),
      credentials.contextWindow,
    );
  }
}
