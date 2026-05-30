/**
 * Ollama provider — a local daemon exposing an OpenAI-compatible API at `/v1`.
 *
 * The wire translation is identical to OpenAI, so we reuse OpenAiProvider and
 * only override identity and the base URL. This is deliberate: the canonical
 * interface lets one adapter back multiple "providers".
 */

import { providerInfo } from "../../catalog.js";
import type { OllamaCredentials, ProviderInfo } from "../../types.js";
import { OpenAiProvider } from "../openai/OpenAiProvider.js";

const INFO: ProviderInfo = providerInfo("ollama");

export class OllamaProvider extends OpenAiProvider {
  override readonly info: ProviderInfo = INFO;

  constructor(credentials: OllamaCredentials) {
    const base = credentials.baseUrl.replace(/\/$/, "");
    super({ type: "openai", apiKey: "ollama", baseUrl: `${base}/v1` });
  }
}
