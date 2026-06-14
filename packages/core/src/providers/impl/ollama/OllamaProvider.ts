/**
 * Ollama provider — a local daemon exposing an OpenAI-compatible API at `/v1`.
 *
 * The wire translation is identical to OpenAI, so we reuse OpenAiProvider and
 * only override identity and the base URL. This is deliberate: the canonical
 * interface lets one adapter back multiple "providers".
 *
 * Beyond generation, Ollama also offers management endpoints (`/api/tags`,
 * `/api/show`) we use to discover the installed models and their capabilities;
 * see {@link listModels}.
 */

import { providerInfo } from "../../catalog.js";
import { withContextWindow } from "../../model-info.js";
import type { OllamaCredentials, ProviderInfo } from "../../types.js";
import { OpenAiProvider } from "../openai/OpenAiProvider.js";
import { fetchOllamaModels, type OllamaModel } from "./models.js";

export class OllamaProvider extends OpenAiProvider {
  override readonly info: ProviderInfo;
  private readonly daemonUrl: string;

  constructor(credentials: OllamaCredentials) {
    const base = credentials.baseUrl.replace(/\/$/, "");
    super({ type: "openai", apiKey: "ollama", baseUrl: `${base}/v1` });
    this.daemonUrl = base;
    this.info = withContextWindow(providerInfo("ollama"), credentials.contextWindow);
  }

  /** Discover installed models with context window and vision capability. */
  listModels(signal?: AbortSignal): Promise<OllamaModel[]> {
    return fetchOllamaModels(this.daemonUrl, signal);
  }
}
