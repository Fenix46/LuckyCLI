import type {
  ProviderCredentials,
  ProviderId,
} from "../providers/types.js";
import { isProviderId } from "../providers/types.js";

export interface AppConfig {
  provider: ProviderId;
  model: string;
  system: string;
  temperature?: number;
  maxTokens?: number;
}

/** Default model per provider when none is supplied. */
const DEFAULT_MODELS: Record<ProviderId, string> = {
  claude: "claude-sonnet-4-6",
  openai: "gpt-4o",
  gemini: "gemini-2.0-flash",
  ollama: "llama3.1",
};

const DEFAULT_SYSTEM_PROMPT =
  "You are lucky, a concise and capable terminal coding assistant. " +
  "Use the available tools to inspect and modify the project when needed. " +
  "Prefer small, verifiable steps and explain what you do briefly.";

export interface CliOverrides {
  provider?: string;
  model?: string;
}

/**
 * Resolve effective configuration from CLI flags, environment variables and
 * built-in defaults, in that order of precedence.
 */
export function loadConfig(
  overrides: CliOverrides = {},
  env: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const providerRaw = overrides.provider ?? env.LUCKY_PROVIDER ?? "claude";
  if (!isProviderId(providerRaw)) {
    throw new Error(
      `Unknown provider "${providerRaw}". Valid: claude, openai, gemini, ollama.`,
    );
  }
  const provider = providerRaw;
  const model = overrides.model ?? env.LUCKY_MODEL ?? DEFAULT_MODELS[provider];

  return {
    provider,
    model,
    system: env.LUCKY_SYSTEM ?? DEFAULT_SYSTEM_PROMPT,
    ...(env.LUCKY_TEMPERATURE
      ? { temperature: Number(env.LUCKY_TEMPERATURE) }
      : {}),
    ...(env.LUCKY_MAX_TOKENS ? { maxTokens: Number(env.LUCKY_MAX_TOKENS) } : {}),
  };
}

/**
 * Build provider credentials from the environment. Throws a clear error if a
 * required key is missing so the CLI can guide the user.
 */
export function credentialsFromEnv(
  provider: ProviderId,
  env: NodeJS.ProcessEnv = process.env,
): ProviderCredentials {
  switch (provider) {
    case "claude":
      return { type: "claude", apiKey: requireEnv(env, "ANTHROPIC_API_KEY") };
    case "openai":
      return {
        type: "openai",
        apiKey: requireEnv(env, "OPENAI_API_KEY"),
        ...(env.OPENAI_BASE_URL ? { baseUrl: env.OPENAI_BASE_URL } : {}),
      };
    case "gemini":
      return { type: "gemini", apiKey: requireEnv(env, "GEMINI_API_KEY") };
    case "ollama":
      return {
        type: "ollama",
        baseUrl: env.OLLAMA_BASE_URL ?? "http://localhost:11434",
      };
  }
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Set it in your environment or .env file.`,
    );
  }
  return value;
}
