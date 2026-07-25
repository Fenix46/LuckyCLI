import {
  PROVIDER_CATALOG,
  type AuthMethod,
  type ClaudeOAuthTokens,
  type OpenAiOAuthTokens,
  type ProviderCredentials,
  type ProviderId,
} from "@luckycli/core";

/** OAuth tokens as collected by the Google/Antigravity browser flows. */
export interface GoogleStyleOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

/**
 * Everything the setup wizard collected before the final model pick. Kept as a
 * plain value object so credential assembly stays a pure function of the form
 * state instead of reading React state through closures.
 */
export interface SetupFormState {
  /** API key, or base URL for baseUrl providers. */
  secret: string;
  /** Second secret: API key for baseUrl providers that also need one. */
  apiKeySecret: string;
  /** Free-text context window override, in tokens. Empty = unset. */
  contextWindow: string;
  /** Context window per model id, as discovered from the endpoint. */
  discoveredContextByModel: Record<string, number>;
  gcpProjectId: string;
  gcpRegion: string;
  googleOAuthTokens: GoogleStyleOAuthTokens | null;
  antigravityOAuthTokens: GoogleStyleOAuthTokens | null;
  claudeOAuthTokens: ClaudeOAuthTokens | null;
  openAiOAuthTokens: OpenAiOAuthTokens | null;
}

/**
 * `undefined` credentials means "the OAuth flow never completed"; the caller
 * sends the user back to the credential step rather than saving junk.
 */
export type BuildCredentialsResult = ProviderCredentials | undefined;

/** Parse the manual context-window override, ignoring blank/invalid input. */
function contextField(raw: string): { contextWindow?: number } {
  const trimmed = raw.trim();
  const n = Number(trimmed);
  return trimmed && Number.isFinite(n) && n > 0 ? { contextWindow: n } : {};
}

/**
 * Assemble the provider credentials from the collected form state. Pure: the
 * caller decides what to do with an `undefined` result (incomplete OAuth).
 */
export function buildCredentials(
  provider: ProviderId,
  authMethod: AuthMethod,
  model: string,
  form: SetupFormState,
): BuildCredentialsResult {
  const ctxField = () => contextField(form.contextWindow);
  // Context window discovered live for the chosen model (gateways), if any.
  const discoveredCtx = form.discoveredContextByModel[model];

  if (provider === "claude") {
    if (authMethod.kind === "oauth") {
      if (!form.claudeOAuthTokens?.accessToken) return undefined;
      return { type: "claude", authMethod: "oauth", ...form.claudeOAuthTokens };
    }
    return { type: "claude", authMethod: "api_key", apiKey: form.secret.trim() };
  }

  if (provider === "openai") {
    return { type: "openai", apiKey: form.secret.trim() };
  }

  if (provider === "openai-oauth") {
    if (!form.openAiOAuthTokens) return undefined;
    return { type: "openai-oauth", ...form.openAiOAuthTokens };
  }

  if (provider === "antigravity") {
    const tokens = form.antigravityOAuthTokens;
    if (!tokens?.accessToken || !tokens.refreshToken) return undefined;
    return {
      type: "antigravity",
      authMethod: "oauth",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {}),
    };
  }

  if (provider === "ollama") {
    // Prefer a manual override; otherwise use the window discovered from
    // /api/show for the chosen model so compaction & metrics work unattended.
    const manual = ctxField();
    const ctx =
      "contextWindow" in manual
        ? manual
        : discoveredCtx
          ? { contextWindow: discoveredCtx }
          : {};
    return { type: "ollama", baseUrl: form.secret.trim(), ...ctx };
  }

  if (provider === "llamacpp") {
    return {
      type: "llamacpp",
      baseUrl: form.secret.trim(),
      ...(form.apiKeySecret.trim() ? { apiKey: form.apiKeySecret.trim() } : {}),
      ...ctxField(),
    };
  }

  if (provider === "vllm") {
    return {
      type: "vllm",
      baseUrl: form.secret.trim(),
      ...(form.apiKeySecret.trim() ? { apiKey: form.apiKeySecret.trim() } : {}),
      ...ctxField(),
    };
  }

  if (provider === "openai-compatible") {
    return {
      type: "openai-compatible",
      baseUrl: form.secret.trim(),
      apiKey: form.apiKeySecret.trim(),
      ...ctxField(),
    };
  }

  if (provider === "openrouter") {
    return {
      type: "openrouter",
      apiKey: form.secret.trim(),
      ...(discoveredCtx ? { contextWindow: discoveredCtx } : {}),
    };
  }

  if (provider === "opencode-zen") {
    // Empty key → core falls back to the shared public (free) key.
    return {
      type: "opencode-zen",
      ...(form.secret.trim() ? { apiKey: form.secret.trim() } : {}),
      ...(discoveredCtx ? { contextWindow: discoveredCtx } : {}),
    };
  }

  if (authMethod.kind === "oauth") {
    const tokens = form.googleOAuthTokens;
    if (!tokens?.accessToken) return undefined;
    return {
      type: "gemini",
      authMethod: "oauth",
      accessToken: tokens.accessToken,
      ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
      ...(tokens.expiresAt ? { expiresAt: tokens.expiresAt } : {}),
    };
  }

  if (authMethod.kind === "vertex") {
    return {
      type: "gemini",
      authMethod: "vertex",
      projectId: form.gcpProjectId.trim(),
      ...(form.gcpRegion.trim() ? { location: form.gcpRegion.trim() } : {}),
    };
  }

  return { type: "gemini", authMethod: "api_key", apiKey: form.secret.trim() };
}

/** Display name for a provider in the picker, with the friendlier aliases. */
export function providerLabel(provider: ProviderId): string {
  if (provider === "openai-oauth") return "ChatGPT Plus/Pro";
  if (provider === "antigravity") return "Google Antigravity";
  const entry = PROVIDER_CATALOG[provider];
  if (entry.company === "Google") return "Google Gemini";
  return entry.displayName;
}

function maskedKey(apiKey: string | undefined): string {
  return apiKey ? `API Key: ${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : "API Key";
}

/** One-line summary of already-stored credentials, shown in the login step. */
export function savedCredentialsLabel(creds: ProviderCredentials): string {
  switch (creds.type) {
    case "claude":
      if (creds.authMethod === "oauth") {
        return creds.email ? `OAuth: ${creds.email}` : "OAuth Session";
      }
      return maskedKey(creds.apiKey);
    case "openai":
      return maskedKey(creds.apiKey);
    case "openai-oauth":
      return "ChatGPT Account";
    case "gemini":
      if (creds.authMethod === "vertex") return `Vertex AI: ${creds.projectId ?? ""}`;
      if (creds.authMethod === "oauth") return "Google OAuth Session";
      return maskedKey(creds.apiKey);
    case "antigravity":
      return "Google Antigravity Session";
    case "ollama":
    case "llamacpp":
    case "vllm":
    case "openai-compatible":
      return `Local URL: ${creds.baseUrl}`;
    default:
      return "Saved Credentials";
  }
}

/** Subtitle of the "Connect account" step, per provider and auth method. */
export function credentialSubtitle(
  provider: ProviderId | null,
  authMethod: AuthMethod,
): string {
  if (authMethod.kind === "oauth") {
    if (provider === "claude") return "A browser window will open for Claude subscription login.";
    if (provider === "openai-oauth") return "A browser window will open for ChatGPT account login.";
    if (provider === "antigravity") return "A browser window will open for Google Antigravity login.";
    return "A browser window will open for Google OAuth login.";
  }
  if (authMethod.kind === "vertex") return "Use your Google Cloud project and region.";
  if (authMethod.kind === "baseUrl") {
    return authMethod.requiresApiKey
      ? "Enter your server's base URL, then its API key. Stored locally in ~/.luckycli/config.json."
      : "Use a local or remote endpoint. Stored locally in ~/.luckycli/config.json.";
  }
  return "Paste the provider API key. It will be stored locally in ~/.luckycli/config.json.";
}
