/**
 * Static provider catalog — display metadata available WITHOUT credentials.
 *
 * The setup dialog uses this to present the provider/model choices before any
 * client is constructed. Each provider's `ProviderInfo` is derived from here,
 * so model lists live in exactly one place.
 */

import type { ModelInfo, ProviderId, ProviderInfo } from "./types.js";

export interface AuthMethod {
  id: string;
  displayName: string;
  kind: "apiKey" | "baseUrl" | "oauth" | "vertex";
  hint: string;
}

export interface ProviderCatalogEntry extends ProviderInfo {
  company: string;
  authMethods: AuthMethod[];
}

export const PROVIDER_CATALOG: Record<ProviderId, ProviderCatalogEntry> = {
  claude: {
    id: "claude",
    displayName: "Anthropic Claude",
    company: "Anthropic",
    availableModels: [
      "claude-opus-4-8",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
    ],
    models: modelEntries([
      { id: "claude-opus-4-8", source: "unknown" },
      { id: "claude-sonnet-4-6", source: "unknown" },
      { id: "claude-haiku-4-5-20251001", source: "unknown" },
    ]),
    defaultModel: "claude-sonnet-4-6",
    supportsStreaming: true,
    supportsVision: true,
    supportsTools: true,
    authMethods: [
      {
        id: "api_key",
        displayName: "Anthropic API Key",
        kind: "apiKey",
        hint: "Anthropic API key (console.anthropic.com)",
      },
      {
        id: "oauth",
        displayName: "Claude Browser Login",
        kind: "oauth",
        hint: "Use a Claude Pro/Max/Team/Enterprise subscription account",
      },
    ],
  },
  openai: {
    id: "openai",
    displayName: "OpenAI",
    company: "OpenAI",
    availableModels: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o4-mini"],
    models: modelEntries([
      {
        id: "gpt-4o",
        contextWindow: 128_000,
        maxOutputTokens: 16_384,
        source: "official",
      },
      {
        id: "gpt-4o-mini",
        contextWindow: 128_000,
        maxOutputTokens: 16_384,
        source: "official",
      },
      {
        id: "gpt-4.1",
        contextWindow: 1_047_576,
        maxOutputTokens: 32_768,
        source: "official",
      },
      {
        id: "o4-mini",
        contextWindow: 200_000,
        maxOutputTokens: 100_000,
        source: "official",
      },
    ]),
    defaultModel: "gpt-4o",
    supportsStreaming: true,
    supportsVision: true,
    supportsTools: true,
    authMethods: [
      {
        id: "api_key",
        displayName: "OpenAI API Key",
        kind: "apiKey",
        hint: "OpenAI API key (platform.openai.com)",
      },
    ],
  },
  "openai-oauth": {
    id: "openai-oauth",
    displayName: "ChatGPT",
    company: "OpenAI",
    availableModels: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-4o"],
    models: modelEntries([
      {
        id: "gpt-5.5",
        contextWindow: 400_000,
        maxInputTokens: 258_400,
        maxOutputTokens: 128_000,
        source: "provider",
      },
      {
        id: "gpt-5.4",
        contextWindow: 1_000_000,
        maxInputTokens: 258_400,
        maxOutputTokens: 128_000,
        source: "provider",
      },
      {
        id: "gpt-5.4-mini",
        contextWindow: 400_000,
        maxInputTokens: 258_400,
        maxOutputTokens: 128_000,
        source: "provider",
      },
      {
        id: "gpt-5.3-codex",
        contextWindow: 400_000,
        maxInputTokens: 258_400,
        maxOutputTokens: 128_000,
        source: "provider",
      },
      {
        id: "gpt-4o",
        contextWindow: 128_000,
        maxOutputTokens: 16_384,
        source: "official",
      },
    ]),
    defaultModel: "gpt-5.5",
    supportsStreaming: true,
    supportsVision: true,
    supportsTools: true,
    authMethods: [
      {
        id: "oauth",
        displayName: "ChatGPT Browser Login",
        kind: "oauth",
        hint: "Use your ChatGPT Plus/Pro account in the browser",
      },
    ],
  },
  gemini: {
    id: "gemini",
    displayName: "Google Gemini",
    company: "Google",
    availableModels: [
      "gemini-3.1-pro-preview",
      "gemini-3.1-flash-lite",
      "gemini-3-pro-preview",
      "gemini-3-flash-preview",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemma-4-31b-it",
      "gemma-4-26b-a4b-it",
    ],
    models: modelEntries([
      { id: "gemini-3.1-pro-preview", source: "unknown" },
      { id: "gemini-3.1-flash-lite", source: "unknown" },
      { id: "gemini-3-pro-preview", source: "unknown" },
      { id: "gemini-3-flash-preview", source: "unknown" },
      { id: "gemini-2.5-pro", source: "unknown" },
      { id: "gemini-2.5-flash", source: "unknown" },
      { id: "gemma-4-31b-it", source: "unknown" },
      { id: "gemma-4-26b-a4b-it", source: "unknown" },
    ]),
    defaultModel: "gemini-2.5-pro",
    supportsStreaming: true,
    supportsVision: true,
    supportsTools: true,
    authMethods: [
      {
        id: "api_key",
        displayName: "Google AI Studio API Key",
        kind: "apiKey",
        hint: "Google AI Studio API key (aistudio.google.com)",
      },
      {
        id: "oauth",
        displayName: "Google OAuth (Personal Gmail)",
        kind: "oauth",
        hint: "Interactive browser login with your Google account",
      },
      {
        id: "vertex",
        displayName: "Vertex AI (Google Cloud Platform)",
        kind: "vertex",
        hint: "Vertex AI GCP credentials (needs project ID)",
      },
    ],
  },
  ollama: {
    id: "ollama",
    displayName: "Ollama (local)",
    company: "Ollama",
    availableModels: ["llama3.1", "qwen2.5", "mistral", "gemma2"],
    models: modelEntries([
      { id: "llama3.1", source: "local" },
      { id: "qwen2.5", source: "local" },
      { id: "mistral", source: "local" },
      { id: "gemma2", source: "local" },
    ]),
    defaultModel: "llama3.1",
    supportsStreaming: true,
    supportsVision: false,
    supportsTools: true,
    authMethods: [
      {
        id: "base_url",
        displayName: "Ollama Local Daemon",
        kind: "baseUrl",
        hint: "Ollama URL (default http://localhost:11434)",
      },
    ],
  },
};

/** The bare ProviderInfo for a provider (no auth fields). */
export function providerInfo(id: ProviderId): ProviderInfo {
  const { company: _company, authMethods: _methods, ...info } = PROVIDER_CATALOG[id];
  return info;
}

export function listProviders(): ProviderCatalogEntry[] {
  return Object.values(PROVIDER_CATALOG);
}

export function modelInfo(provider: ProviderId, model: string): ModelInfo {
  return (
    PROVIDER_CATALOG[provider].models?.[model] ?? {
      id: model,
      source: "unknown",
    }
  );
}

function modelEntries(models: ModelInfo[]): Record<string, ModelInfo> {
  return Object.fromEntries(models.map((model) => [model.id, model]));
}
