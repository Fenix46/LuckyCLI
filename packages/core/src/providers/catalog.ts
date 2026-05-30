/**
 * Static provider catalog — display metadata available WITHOUT credentials.
 *
 * The setup dialog uses this to present the provider/model choices before any
 * client is constructed. Each provider's `ProviderInfo` is derived from here,
 * so model lists live in exactly one place.
 */

import type { ProviderId, ProviderInfo } from "./types.js";

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
    ],
  },
  openai: {
    id: "openai",
    displayName: "OpenAI",
    company: "OpenAI",
    availableModels: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o4-mini"],
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
