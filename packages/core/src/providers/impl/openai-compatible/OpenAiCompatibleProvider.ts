/**
 * Generic OpenAI-compatible provider — for any server that speaks the OpenAI
 * HTTP API. Unlike the named local providers (Ollama, llama.cpp, vLLM), here we
 * make no assumptions: the user enters both the base URL and the API key by
 * hand, and we forward them verbatim.
 *
 * The base URL is used as-is. We only append `/v1` when the user clearly gave a
 * bare origin (no path) — if they already included a path like `/v1` or a
 * gateway prefix, we leave it untouched.
 */

import { providerInfo } from "../../catalog.js";
import type { OpenAiCompatibleCredentials, ProviderInfo } from "../../types.js";
import { OpenAiProvider } from "../openai/OpenAiProvider.js";

const INFO: ProviderInfo = providerInfo("openai-compatible");

/**
 * Normalize a user-supplied base URL: strip the trailing slash, and append
 * `/v1` only when no path segment was provided.
 */
export function normalizeOpenAiCompatibleBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  let hasPath = false;
  try {
    hasPath = new URL(trimmed).pathname.replace(/\/+$/, "") !== "";
  } catch {
    // Not a parseable URL; fall back to a heuristic below.
    hasPath = /\/[^/]+$/.test(trimmed.replace(/^https?:\/\/[^/]+/, ""));
  }
  return hasPath ? trimmed : `${trimmed}/v1`;
}

export class OpenAiCompatibleProvider extends OpenAiProvider {
  override readonly info: ProviderInfo = INFO;

  constructor(credentials: OpenAiCompatibleCredentials) {
    super({
      type: "openai",
      apiKey: credentials.apiKey,
      baseUrl: normalizeOpenAiCompatibleBaseUrl(credentials.baseUrl),
    });
  }
}
