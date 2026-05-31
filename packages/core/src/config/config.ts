import { PROVIDER_CATALOG } from "../providers/catalog.js";
import type { ProviderCredentials, ProviderId } from "../providers/types.js";
import { isProviderId } from "../providers/types.js";
import { loadStoredConfig, type StoredConfig } from "./store.js";

export const DEFAULT_SYSTEM_PROMPT =
  "You are lucky, a concise and capable terminal coding assistant. " +
  "Use the available tools to inspect and modify the project when needed. " +
  "Prefer small, verifiable steps and explain what you do briefly.";

export interface CliOverrides {
  provider?: string;
  model?: string;
}

/**
 * The fully resolved runtime configuration. `needsSetup` is true when we don't
 * yet have both a provider and usable credentials — the CLI then shows the
 * setup dialog instead of failing.
 */
export interface ResolvedConfig {
  provider?: ProviderId;
  model?: string;
  system: string;
  temperature?: number;
  maxTokens?: number;
  credentials?: ProviderCredentials;
  needsSetup: boolean;
}

/**
 * Resolve configuration from (in order of precedence): CLI flags, the stored
 * config file, environment variables, then built-in defaults. Nothing here
 * throws for missing credentials — that surfaces as `needsSetup`.
 */
export function resolveConfig(
  overrides: CliOverrides = {},
  stored: StoredConfig = loadStoredConfig(),
  env: NodeJS.ProcessEnv = process.env,
): ResolvedConfig {
  const providerRaw = overrides.provider ?? stored.provider ?? env.LUCKY_PROVIDER;
  let provider: ProviderId | undefined;
  if (providerRaw) {
    if (!isProviderId(providerRaw)) {
      throw new Error(
        `Unknown provider "${providerRaw}". Valid: claude, openai, openai-oauth, gemini, ollama.`,
      );
    }
    provider = providerRaw;
  }

  const model = provider
    ? overrides.model ??
      stored.model ??
      env.LUCKY_MODEL ??
      PROVIDER_CATALOG[provider].defaultModel
    : undefined;

  const credentials = provider
    ? resolveCredentials(provider, stored, env)
    : undefined;

  return {
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    system: env.LUCKY_SYSTEM ?? DEFAULT_SYSTEM_PROMPT,
    ...(env.LUCKY_TEMPERATURE
      ? { temperature: Number(env.LUCKY_TEMPERATURE) }
      : {}),
    ...(env.LUCKY_MAX_TOKENS ? { maxTokens: Number(env.LUCKY_MAX_TOKENS) } : {}),
    ...(credentials ? { credentials } : {}),
    needsSetup: !provider || !credentials,
  };
}

/**
 * Credentials for a provider: stored config first, then environment fallback.
 * Returns undefined when nothing is available (so the caller can prompt).
 */
export function resolveCredentials(
  provider: ProviderId,
  stored: StoredConfig = loadStoredConfig(),
  env: NodeJS.ProcessEnv = process.env,
): ProviderCredentials | undefined {
  const fromStore = stored.credentials?.[provider];
  if (fromStore) return fromStore;
  try {
    return credentialsFromEnv(provider, env);
  } catch {
    return undefined;
  }
}

/** Build provider credentials from environment variables (override path). */
export function credentialsFromEnv(
  provider: ProviderId,
  env: NodeJS.ProcessEnv = process.env,
): ProviderCredentials {
  switch (provider) {
    case "claude":
      if (env.ANTHROPIC_AUTH_TOKEN) {
        return {
          type: "claude",
          authMethod: "oauth",
          accessToken: env.ANTHROPIC_AUTH_TOKEN,
          ...(env.ANTHROPIC_REFRESH_TOKEN ? { refreshToken: env.ANTHROPIC_REFRESH_TOKEN } : {}),
        };
      }
      return { type: "claude", authMethod: "api_key", apiKey: requireEnv(env, "ANTHROPIC_API_KEY") };
    case "openai":
      return {
        type: "openai",
        apiKey: requireEnv(env, "OPENAI_API_KEY"),
        ...(env.OPENAI_BASE_URL ? { baseUrl: env.OPENAI_BASE_URL } : {}),
      };
    case "openai-oauth":
      throw new Error("OpenAI OAuth requires browser login via setup.");
    case "gemini":
      if (env.GEMINI_API_KEY) {
        return { type: "gemini", authMethod: "api_key", apiKey: env.GEMINI_API_KEY };
      }
      if (env.GOOGLE_CLOUD_PROJECT || env.GOOGLE_APPLICATION_CREDENTIALS) {
        return {
          type: "gemini",
          authMethod: "vertex",
          projectId: env.GOOGLE_CLOUD_PROJECT,
          location: env.GOOGLE_CLOUD_LOCATION || "us-central1",
        };
      }
      throw new Error("Missing GEMINI_API_KEY or GOOGLE_CLOUD_PROJECT.");
    case "ollama":
      return {
        type: "ollama",
        baseUrl: env.OLLAMA_BASE_URL ?? "http://localhost:11434",
      };
  }
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}
