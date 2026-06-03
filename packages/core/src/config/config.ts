import { PROVIDER_CATALOG } from "../providers/catalog.js";
import { parseMcpServerConfigRecord, type McpServerConfig } from "../mcp/types.js";
import type { ProviderCredentials, ProviderId } from "../providers/types.js";
import { isProviderId } from "../providers/types.js";
import { DEFAULT_TOOL_PERMISSION_POLICY, parseToolPermissionPolicyEnv, type ToolPermissionPolicy } from "../tools/permissions.js";
import { buildSystemPrompt } from "../prompts/index.js";
import { loadStoredConfig, type StoredConfig } from "./store.js";

/**
 * The default system prompt, composed from the section files in ../prompts.
 * Per-section env overrides (LUCKY_PROMPT_*) are applied inside buildSystemPrompt;
 * LUCKY_SYSTEM (handled in resolveConfig) overrides the whole thing.
 */
export const DEFAULT_SYSTEM_PROMPT = buildSystemPrompt();

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
  mcp: Record<string, McpServerConfig>;
  permissions: ToolPermissionPolicy;
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
        `Unknown provider "${providerRaw}". Valid: claude, openai, openai-oauth, gemini, antigravity, ollama.`,
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

  const envPermissions = parseToolPermissionPolicyEnv(env.LUCKY_TOOL_PERMISSIONS);

  return {
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    system: env.LUCKY_SYSTEM ?? buildSystemPrompt(undefined, env),
    ...(env.LUCKY_TEMPERATURE
      ? { temperature: Number(env.LUCKY_TEMPERATURE) }
      : {}),
    ...(env.LUCKY_MAX_TOKENS ? { maxTokens: Number(env.LUCKY_MAX_TOKENS) } : {}),
    ...(credentials ? { credentials } : {}),
    mcp: parseMcpServerConfigRecord(stored.mcp),
    permissions: {
      ...DEFAULT_TOOL_PERMISSION_POLICY,
      ...(stored.permissions ?? {}),
      ...(envPermissions ?? {}),
    },
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
    case "antigravity":
      if (env.ANTIGRAVITY_ACCESS_TOKEN) {
        return {
          type: "antigravity",
          authMethod: "oauth",
          accessToken: env.ANTIGRAVITY_ACCESS_TOKEN,
          ...(env.ANTIGRAVITY_REFRESH_TOKEN ? { refreshToken: env.ANTIGRAVITY_REFRESH_TOKEN } : {}),
          ...(env.ANTIGRAVITY_EXPIRES_AT ? { expiresAt: Number(env.ANTIGRAVITY_EXPIRES_AT) } : {}),
        };
      }
      throw new Error("Antigravity requires browser login via setup.");
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
