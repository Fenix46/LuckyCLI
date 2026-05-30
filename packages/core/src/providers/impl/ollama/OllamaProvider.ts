/**
 * Ollama provider — a local daemon exposing an OpenAI-compatible API at `/v1`.
 *
 * The wire translation is identical to OpenAI, so we reuse OpenAiProvider and
 * only override identity and the base URL. This is deliberate: the canonical
 * interface lets one adapter back multiple "providers".
 */

import type { OllamaCredentials, ProviderInfo } from "../../types.js";
import { OpenAiProvider } from "../openai/OpenAiProvider.js";

const INFO: ProviderInfo = {
  id: "ollama",
  displayName: "Ollama (local)",
  availableModels: ["llama3.1", "qwen2.5", "mistral", "gemma2"],
  defaultModel: "llama3.1",
  supportsStreaming: true,
  supportsVision: false,
  supportsTools: true,
};

export class OllamaProvider extends OpenAiProvider {
  override readonly info: ProviderInfo = INFO;

  constructor(credentials: OllamaCredentials) {
    const base = credentials.baseUrl.replace(/\/$/, "");
    super({ type: "openai", apiKey: "ollama", baseUrl: `${base}/v1` });
  }
}
