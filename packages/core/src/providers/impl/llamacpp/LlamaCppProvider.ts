/**
 * llama.cpp provider — the bundled `llama-server` exposes an OpenAI-compatible
 * API at `/v1`. Like Ollama, the wire format is identical to OpenAI, so we
 * reuse OpenAiProvider and only override identity and the base URL.
 *
 * `llama-server` can be launched with `--api-key`; when set, the user supplies
 * it and we forward it as the bearer token. Otherwise a placeholder is fine —
 * the server ignores it.
 */

import { providerInfo } from "../../catalog.js";
import { withContextWindow } from "../../model-info.js";
import type { LlamaCppCredentials, ProviderInfo } from "../../types.js";
import { OpenAiProvider } from "../openai/OpenAiProvider.js";

export class LlamaCppProvider extends OpenAiProvider {
  override readonly info: ProviderInfo;

  constructor(credentials: LlamaCppCredentials) {
    const base = credentials.baseUrl.replace(/\/$/, "");
    super({
      type: "openai",
      apiKey: credentials.apiKey || "llamacpp",
      baseUrl: `${base}/v1`,
    });
    this.info = withContextWindow(providerInfo("llamacpp"), credentials.contextWindow);
  }
}
