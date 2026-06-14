/**
 * vLLM provider — a high-throughput inference server exposing an
 * OpenAI-compatible API at `/v1`. The wire format is identical to OpenAI, so we
 * reuse OpenAiProvider and only override identity and the base URL.
 *
 * vLLM can be launched with `--api-key`; when set, the user supplies it and we
 * forward it as the bearer token. Otherwise a placeholder is fine.
 */

import { providerInfo } from "../../catalog.js";
import { withContextWindow } from "../../model-info.js";
import type { ProviderInfo, VllmCredentials } from "../../types.js";
import { OpenAiProvider } from "../openai/OpenAiProvider.js";

export class VllmProvider extends OpenAiProvider {
  override readonly info: ProviderInfo;

  constructor(credentials: VllmCredentials) {
    const base = credentials.baseUrl.replace(/\/$/, "");
    super({
      type: "openai",
      apiKey: credentials.apiKey || "vllm",
      baseUrl: `${base}/v1`,
    });
    this.info = withContextWindow(providerInfo("vllm"), credentials.contextWindow);
  }
}
