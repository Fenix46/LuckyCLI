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
  /** For `baseUrl` methods: the value to pre-fill in the setup dialog. */
  defaultBaseUrl?: string;
  /**
   * For `baseUrl` methods: also prompt for an API key (e.g. a custom
   * OpenAI-compatible server). Optional keys (vLLM/llama.cpp) leave this false
   * and accept an empty value.
   */
  requiresApiKey?: boolean;
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
      "claude-fable-5",
      "claude-opus-4-8",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
    ],
    models: modelEntries([
      { id: "claude-fable-5", source: "unknown" },
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
    // NOTE: the real model list is fetched live from /codex/models once
    // authenticated (see fetchCodexModels). These entries are only a bootstrap
    // for the pre-auth setup dialog and a source of context-window metadata for
    // modelInfo(); the picker and validation use the live catalog.
    displayName: "ChatGPT",
    company: "OpenAI",
    availableModels: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"],
    models: modelEntries([
      {
        id: "gpt-5.5",
        contextWindow: 258_400,
        maxInputTokens: 258_400,
        maxOutputTokens: 128_000,
        source: "provider",
      },
      {
        id: "gpt-5.4",
        contextWindow: 258_400,
        maxInputTokens: 258_400,
        maxOutputTokens: 128_000,
        source: "provider",
      },
      {
        id: "gpt-5.4-mini",
        contextWindow: 258_400,
        maxInputTokens: 258_400,
        maxOutputTokens: 128_000,
        source: "provider",
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
  antigravity: {
    id: "antigravity",
    displayName: "Google Antigravity",
    company: "Google",
    availableModels: [
      "gemini-3.5-flash-low",
      "gemini-3-flash-agent",
      "gemini-3.5-flash-extra-low",
      "gemini-3.1-pro-low",
      "gemini-pro-agent",
      "gemini-3-flash",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-3.1-flash-lite",
      "claude-sonnet-4-6",
      "claude-opus-4-6-thinking",
      "gpt-oss-120b-medium",
    ],
    models: modelEntries([
      { id: "gemini-3.5-flash-low", contextWindow: 1_048_576, maxOutputTokens: 65_536, source: "provider" },
      { id: "gemini-3-flash-agent", contextWindow: 1_048_576, maxOutputTokens: 65_536, source: "provider" },
      { id: "gemini-3.5-flash-extra-low", contextWindow: 1_048_576, maxOutputTokens: 65_536, source: "provider" },
      { id: "gemini-3.1-pro-low", contextWindow: 1_048_576, maxOutputTokens: 65_535, source: "provider" },
      { id: "gemini-pro-agent", contextWindow: 1_048_576, maxOutputTokens: 65_535, source: "provider" },
      { id: "gemini-3-flash", contextWindow: 1_048_576, maxOutputTokens: 65_536, source: "provider" },
      { id: "gemini-2.5-pro", source: "provider" },
      { id: "gemini-2.5-flash", source: "provider" },
      { id: "gemini-2.5-flash-lite", source: "provider" },
      { id: "gemini-3.1-flash-lite", source: "provider" },
      { id: "claude-sonnet-4-6", contextWindow: 250_000, maxOutputTokens: 64_000, source: "provider" },
      { id: "claude-opus-4-6-thinking", contextWindow: 250_000, maxOutputTokens: 64_000, source: "provider" },
      { id: "gpt-oss-120b-medium", contextWindow: 131_072, maxOutputTokens: 32_768, source: "provider" },
    ]),
    defaultModel: "gemini-3.5-flash-low",
    supportsStreaming: true,
    supportsVision: true,
    supportsTools: true,
    authMethods: [
      {
        id: "oauth",
        displayName: "Antigravity Browser Login",
        kind: "oauth",
        hint: "Use your Google Antigravity account in the browser",
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
        defaultBaseUrl: "http://localhost:11434",
      },
    ],
  },
  llamacpp: {
    id: "llamacpp",
    displayName: "llama.cpp (local)",
    company: "llama.cpp",
    // The model name depends on what the server was launched with, so there is
    // no static list and no safe default: the user types it in. Validation is
    // permissive and the setup model step is a free-text input.
    availableModels: [],
    models: {},
    defaultModel: "",
    supportsStreaming: true,
    supportsVision: false,
    supportsTools: true,
    authMethods: [
      {
        id: "base_url",
        displayName: "llama.cpp Server",
        kind: "baseUrl",
        hint: "llama-server URL (default http://localhost:8080)",
        defaultBaseUrl: "http://localhost:8080",
      },
    ],
  },
  vllm: {
    id: "vllm",
    displayName: "vLLM (local)",
    company: "vLLM",
    availableModels: [],
    models: {},
    defaultModel: "",
    supportsStreaming: true,
    supportsVision: false,
    supportsTools: true,
    authMethods: [
      {
        id: "base_url",
        displayName: "vLLM Server",
        kind: "baseUrl",
        hint: "vLLM URL (default http://localhost:8000)",
        defaultBaseUrl: "http://localhost:8000",
      },
    ],
  },
  "openai-compatible": {
    id: "openai-compatible",
    displayName: "OpenAI-compatible (custom)",
    company: "Custom",
    availableModels: [],
    models: {},
    defaultModel: "",
    supportsStreaming: true,
    supportsVision: false,
    supportsTools: true,
    authMethods: [
      {
        id: "base_url",
        displayName: "Custom OpenAI-compatible Server",
        kind: "baseUrl",
        hint: "Server base URL, then your API key",
        requiresApiKey: true,
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
