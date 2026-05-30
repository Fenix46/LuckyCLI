/**
 * Static provider catalog — display metadata available WITHOUT credentials.
 *
 * The setup dialog uses this to present the provider/model choices before any
 * client is constructed. Each provider's `ProviderInfo` is derived from here,
 * so model lists live in exactly one place.
 */

import type { ProviderId, ProviderInfo } from "./types.js";

/** How a provider is authenticated, which drives what the setup dialog asks. */
export type AuthKind = "apiKey" | "baseUrl";

export interface ProviderCatalogEntry extends ProviderInfo {
  /** What the user must supply to use this provider. */
  auth: AuthKind;
  /** Human hint shown in the setup prompt. */
  authHint: string;
}

export const PROVIDER_CATALOG: Record<ProviderId, ProviderCatalogEntry> = {
  claude: {
    id: "claude",
    displayName: "Anthropic Claude",
    availableModels: [
      "claude-opus-4-8",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
    ],
    defaultModel: "claude-sonnet-4-6",
    supportsStreaming: true,
    supportsVision: true,
    supportsTools: true,
    auth: "apiKey",
    authHint: "Anthropic API key (console.anthropic.com)",
  },
  openai: {
    id: "openai",
    displayName: "OpenAI",
    availableModels: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o4-mini"],
    defaultModel: "gpt-4o",
    supportsStreaming: true,
    supportsVision: true,
    supportsTools: true,
    auth: "apiKey",
    authHint: "OpenAI API key (platform.openai.com)",
  },
  gemini: {
    id: "gemini",
    displayName: "Google Gemini",
    availableModels: ["gemini-2.0-flash", "gemini-2.0-pro", "gemini-1.5-pro"],
    defaultModel: "gemini-2.0-flash",
    supportsStreaming: true,
    supportsVision: true,
    supportsTools: true,
    auth: "apiKey",
    authHint: "Google AI Studio API key (aistudio.google.com)",
  },
  ollama: {
    id: "ollama",
    displayName: "Ollama (local)",
    availableModels: ["llama3.1", "qwen2.5", "mistral", "gemma2"],
    defaultModel: "llama3.1",
    supportsStreaming: true,
    supportsVision: false,
    supportsTools: true,
    auth: "baseUrl",
    authHint: "Ollama daemon URL",
  },
};

/** The bare ProviderInfo for a provider (no auth fields). */
export function providerInfo(id: ProviderId): ProviderInfo {
  const { auth: _auth, authHint: _hint, ...info } = PROVIDER_CATALOG[id];
  return info;
}

export function listProviders(): ProviderCatalogEntry[] {
  return Object.values(PROVIDER_CATALOG);
}
