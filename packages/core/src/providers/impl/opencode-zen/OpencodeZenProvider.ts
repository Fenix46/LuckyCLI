/**
 * opencode Zen provider — opencode's hosted, OpenAI-compatible gateway. We reuse
 * the OpenAI Chat Completions adapter and fix the base URL plus attribution
 * header. The API key is optional: without one we fall back to the shared
 * "public" key, which opencode accepts for its free model tier.
 */

import { providerInfo } from "../../catalog.js";
import { withContextWindow } from "../../model-info.js";
import type {
  ModelInfo,
  OpencodeZenCredentials,
  ProviderInfo,
} from "../../types.js";
import { OpenAiProvider } from "../openai/OpenAiProvider.js";
import { fetchOpencodeZenContextWindows } from "./context.js";

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
    // zen model ids are live (not in the static catalog) and each has its own
    // context window. A saved credentials.contextWindow is only an immediate
    // hint for the active model (avoids a blank first turn); the authoritative
    // per-model windows are loaded below from models.dev.
    const seeded = withContextWindow(
      providerInfo("opencode-zen"),
      credentials.contextWindow,
    );
    // Ensure a mutable own `models` map we can fill in place; the agent re-reads
    // provider.info.models on every context check, so the async fill is picked
    // up without rebuilding the agent.
    this.info = { ...seeded, models: { ...(seeded.models ?? {}) } };
    void this.preloadModelWindows();
  }

  /**
   * Fetch every zen model's context window from models.dev and merge it into
   * `info.models`, so currentModelInfo() resolves the right window for ANY
   * model the user selects — independent of what was saved at setup. Best
   * effort: failures leave the existing (possibly empty) map untouched.
   */
  private async preloadModelWindows(): Promise<void> {
    const windows = await fetchOpencodeZenContextWindows();
    const models = this.info.models as Record<string, ModelInfo>;
    for (const [id, contextWindow] of Object.entries(windows)) {
      models[id] = { ...(models[id] ?? { id }), id, contextWindow };
    }
  }
}
