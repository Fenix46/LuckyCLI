/**
 * Provider layer entry point. Importing this module registers every built-in
 * provider factory, after which `getProvider(id, credentials)` works.
 */

import { ClaudeProvider } from "./impl/claude/ClaudeProvider.js";
import { GeminiProvider } from "./impl/gemini/GeminiProvider.js";
import { OllamaProvider } from "./impl/ollama/OllamaProvider.js";
import { OpenAiProvider } from "./impl/openai/OpenAiProvider.js";
import { registerProviderFactory } from "./registry.js";
import type {
  ClaudeCredentials,
  GeminiCredentials,
  OllamaCredentials,
  OpenAiCredentials,
} from "./types.js";

let registered = false;

/** Idempotently register all built-in provider factories. */
export function registerBuiltinProviders(): void {
  if (registered) return;
  registered = true;

  registerProviderFactory("claude", (c) =>
    new ClaudeProvider(c as ClaudeCredentials),
  );
  registerProviderFactory("openai", (c) =>
    new OpenAiProvider(c as OpenAiCredentials),
  );
  registerProviderFactory("gemini", (c) =>
    new GeminiProvider(c as GeminiCredentials),
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
  providerInfo,
} from "./catalog.js";
export type { AuthMethod, ProviderCatalogEntry } from "./catalog.js";
export {
  getProvider,
  getRegisteredProviderIds,
  registerProviderFactory,
  resetProvider,
} from "./registry.js";
