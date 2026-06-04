/**
 * Provider layer entry point. Importing this module registers every built-in
 * provider factory, after which `getProvider(id, credentials)` works.
 */

import { ClaudeProvider } from "./impl/claude/ClaudeProvider.js";
import { AntigravityProvider } from "./impl/antigravity/AntigravityProvider.js";
import { GeminiProvider } from "./impl/gemini/GeminiProvider.js";
import { OllamaProvider } from "./impl/ollama/OllamaProvider.js";
import { OpenAiOAuthProvider } from "./impl/openai-oauth/OpenAiOAuthProvider.js";
import { OpenAiProvider } from "./impl/openai/OpenAiProvider.js";
import { registerProviderFactory } from "./registry.js";
import { loadStoredConfig, saveStoredConfig } from "../config/store.js";
import type {
  ClaudeCredentials,
  AntigravityCredentials,
  GeminiCredentials,
  OllamaCredentials,
  OpenAiCredentials,
  OpenAiOAuthCredentials,
} from "./types.js";

let registered = false;

/** Idempotently register all built-in provider factories. */
export function registerBuiltinProviders(): void {
  if (registered) return;
  registered = true;

  registerProviderFactory("claude", (c) =>
    new ClaudeProvider(c as ClaudeCredentials, (credentials) => {
      const cfg = loadStoredConfig();
      cfg.credentials = {
        ...cfg.credentials,
        claude: credentials,
      };
      saveStoredConfig(cfg);
    }),
  );
  registerProviderFactory("openai", (c) =>
    new OpenAiProvider(c as OpenAiCredentials),
  );
  registerProviderFactory("openai-oauth", (c) =>
    new OpenAiOAuthProvider(c as OpenAiOAuthCredentials, (tokens) => {
      const cfg = loadStoredConfig();
      cfg.credentials = {
        ...cfg.credentials,
        "openai-oauth": { type: "openai-oauth", ...tokens },
      };
      saveStoredConfig(cfg);
    }),
  );
  registerProviderFactory("gemini", (c) =>
    new GeminiProvider(c as GeminiCredentials),
  );
  registerProviderFactory("antigravity", (c) =>
    new AntigravityProvider(c as AntigravityCredentials),
  );
  registerProviderFactory("ollama", (c) =>
    new OllamaProvider(c as OllamaCredentials),
  );
}

// Register on import so consumers just `import "@luckycli/core"`.
registerBuiltinProviders();

export * from "./types.js";
export type { IProvider } from "./IProvider.js";
export {
  PROVIDER_CATALOG,
  listProviders,
  modelInfo,
  providerInfo,
} from "./catalog.js";
export type { AuthMethod, ProviderCatalogEntry } from "./catalog.js";
export { runOpenAiBrowserOAuthFlow } from "./impl/openai-oauth/oauthFlow.js";
export type { OpenAiOAuthTokens } from "./impl/openai-oauth/OpenAiOAuthProvider.js";
export { fetchCodexModels } from "./impl/openai-oauth/models.js";
export type { CodexModel, CodexReasoningLevel } from "./impl/openai-oauth/models.js";
export {
  CodexModelCache,
  defaultEffortFor,
  effortLevelsFor,
} from "./impl/openai-oauth/model-cache.js";
export { runClaudeBrowserOAuthFlow } from "./impl/claude/oauth.js";
export type { ClaudeOAuthTokens } from "./impl/claude/oauth.js";
export {
  startAntigravityOAuthFlow,
  refreshAntigravityAccessToken,
} from "./impl/gemini/GoogleAuthHelper.js";
export {
  getProvider,
  getRegisteredProviderIds,
  registerProviderFactory,
  resetProvider,
} from "./registry.js";
