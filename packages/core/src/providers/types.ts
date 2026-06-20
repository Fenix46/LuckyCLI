/**
 * Canonical, provider-neutral types — the spine of the whole engine.
 *
 * No SDK imports live here. Every provider adapts TO these types, never the
 * other way around, and nothing outside `providers/impl/*` ever imports a
 * vendor SDK. This is the contract the agent loop, tools and CLI speak.
 */

// ─── Roles ───────────────────────────────────────────────────────────────────

export type MessageRole = "user" | "assistant" | "system" | "tool";

// ─── Content parts ───────────────────────────────────────────────────────────

export interface TextPart {
  type: "text";
  text: string;
}

/** Image input for vision-capable models. */
export interface ImagePart {
  type: "image";
  /** base64-encoded image data */
  data: string;
  mimeType: string;
}

/** A request from the model to invoke a tool. */
export interface ToolCallPart {
  type: "tool_call";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** The outcome of executing a tool, fed back to the model. */
export interface ToolResultPart {
  type: "tool_result";
  /** Must match the id of the originating ToolCallPart. */
  toolCallId: string;
  /** The name of the tool being called (e.g. "exec"). */
  name: string;
  content: string;
  isError?: boolean;
}

export type ContentPart = TextPart | ImagePart | ToolCallPart | ToolResultPart;

// ─── Message ─────────────────────────────────────────────────────────────────

export interface Message {
  role: MessageRole;
  content: ContentPart[];
}

// ─── Tool definition (what the agent advertises to a provider) ───────────────

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the input parameters. */
  parameters: Record<string, unknown>;
}

// ─── Generation config ───────────────────────────────────────────────────────

export interface GenerationConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
  systemPrompt?: string;
  tools?: ToolDefinition[];
  abortSignal?: AbortSignal;
  /**
   * Reasoning effort for providers that expose it (e.g. ChatGPT/Codex,
   * Claude output_config.effort). An open string so new server-side levels
   * work without a code change. Providers that don't support it ignore it.
   */
  reasoningEffort?: string;
  /**
   * Optional thinking toggle for providers that expose an explicit thinking
   * mode separate from effort (currently Claude). Providers that do not
   * support it ignore the flag.
   */
  thinkingEnabled?: boolean;
}

// ─── Responses ───────────────────────────────────────────────────────────────

export type FinishReason =
  | "stop"
  | "max_tokens"
  | "tool_calls"
  | "content_filter"
  | "error"
  | "unknown";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Prompt-cache accounting, when the provider reports it. */
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface GenerationResponse {
  content: ContentPart[];
  finishReason: FinishReason;
  usage?: TokenUsage;
  /** Raw provider payload — never depend on this in engine code. */
  rawMetadata?: unknown;
}

/**
 * A single increment of a streamed assistant turn. `toolCall` is emitted once,
 * fully assembled. `finishReason`/`usage` appear only on the final chunk.
 */
export interface StreamChunk {
  textDelta?: string;
  toolCall?: ToolCallPart;
  finishReason?: FinishReason;
  usage?: TokenUsage;
  /**
   * The model is in a silent reasoning phase that emits no text yet (e.g. Codex
   * thinking before the first output token). Lets the UI show an active
   * "reasoning" state so a slow turn doesn't look hung.
   */
  reasoning?: boolean;
}

// ─── Provider identity & capabilities ────────────────────────────────────────

export type ProviderId =
  | "claude"
  | "openai"
  | "openai-oauth"
  | "gemini"
  | "antigravity"
  | "ollama"
  | "llamacpp"
  | "vllm"
  | "openai-compatible"
  | "openrouter"
  | "opencode-zen";

export const PROVIDER_IDS: readonly ProviderId[] = [
  "claude",
  "openai",
  "openai-oauth",
  "gemini",
  "antigravity",
  "ollama",
  "llamacpp",
  "vllm",
  "openai-compatible",
  "openrouter",
  "opencode-zen",
];

/**
 * Local / self-hosted providers reached over a user-supplied base URL. The CLI
 * treats these uniformly: a default URL comes from the catalog, model ids are
 * validated permissively (the real list is whatever the server has loaded), and
 * vision/tool support can only be known once we talk to the endpoint.
 */
export const BASE_URL_PROVIDER_IDS: readonly ProviderId[] = [
  "ollama",
  "llamacpp",
  "vllm",
  "openai-compatible",
];

export function isBaseUrlProvider(id: ProviderId): boolean {
  return (BASE_URL_PROVIDER_IDS as readonly string[]).includes(id);
}

export interface ProviderInfo {
  id: ProviderId;
  displayName: string;
  availableModels: string[];
  models?: Record<string, ModelInfo>;
  defaultModel: string;
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsTools: boolean;
  /**
   * Context window (tokens) to assume for any model id not found in `models`.
   * Set by local providers when the user supplies a manual override, since
   * their model name is arbitrary and not in the static catalog.
   */
  defaultContextWindow?: number;
}

export interface ModelInfo {
  id: string;
  contextWindow?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  source?: "official" | "provider" | "local" | "unknown";
}

// ─── Provider runtime status ────────────────────────────────────────────────

export interface ProviderQuotaStatus {
  label: string;
  remaining?: string;
  resetTime?: string;
  modelId?: string;
  tokenType?: string;
}

export interface ProviderStatus {
  provider: ProviderId;
  displayName: string;
  authType: string;
  account?: string;
  project?: string;
  subscription?: string;
  tier?: string;
  quotas?: ProviderQuotaStatus[];
  notes?: string[];
}

// ─── Provider credentials (discriminated by provider id) ─────────────────────

export interface ClaudeCredentials {
  type: "claude";
  authMethod?: "api_key" | "oauth";
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
  accountUuid?: string;
  email?: string;
  organizationUuid?: string;
  organizationName?: string;
  subscriptionType?: "pro" | "max" | "team" | "enterprise";
  rateLimitTier?: string;
  billingType?: string;
}

export interface OpenAiCredentials {
  type: "openai";
  apiKey: string;
  baseUrl?: string;
  /**
   * Extra HTTP headers sent on every request (e.g. gateway attribution headers
   * like `HTTP-Referer`/`X-Title`). Forwarded verbatim as the SDK's
   * `defaultHeaders`. Optional — omitted for the plain OpenAI provider.
   */
  extraHeaders?: Record<string, string>;
}

export interface OpenAiOAuthCredentials {
  type: "openai-oauth";
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
}

export interface GeminiCredentials {
  type: "gemini";
  authMethod?: "api_key" | "oauth" | "vertex";
  apiKey?: string;
  projectId?: string;
  location?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface AntigravityCredentials {
  type: "antigravity";
  authMethod: "oauth";
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface OllamaCredentials {
  type: "ollama";
  baseUrl: string;
  /** Manual context-window override (tokens). Auto-discovered when omitted. */
  contextWindow?: number;
}

export interface LlamaCppCredentials {
  type: "llamacpp";
  baseUrl: string;
  /** Optional: llama-server can be started with --api-key. */
  apiKey?: string;
  /** Manual context-window override (tokens). Auto-discovered when omitted. */
  contextWindow?: number;
}

export interface VllmCredentials {
  type: "vllm";
  baseUrl: string;
  /** Optional: vLLM can be started with --api-key. */
  apiKey?: string;
  /** Manual context-window override (tokens). Auto-discovered when omitted. */
  contextWindow?: number;
}

/**
 * A user-run server that speaks the OpenAI HTTP API. Both the base URL and the
 * API key are entered by hand — we make no assumptions about either.
 */
export interface OpenAiCompatibleCredentials {
  type: "openai-compatible";
  baseUrl: string;
  apiKey: string;
  /**
   * Context window (tokens). There's no discovery endpoint we can rely on for
   * an arbitrary server, so this is the primary way to set it — without it the
   * context indicator and auto-compaction can't know the limit.
   */
  contextWindow?: number;
}

/**
 * OpenRouter — an OpenAI-compatible aggregator. Only an API key is needed; the
 * base URL and attribution headers are fixed by the provider implementation.
 */
export interface OpenRouterCredentials {
  type: "openrouter";
  apiKey: string;
}

/**
 * opencode-zen — opencode's hosted gateway. The API key is optional: without
 * one the provider falls back to the shared public key (free models only).
 */
export interface OpencodeZenCredentials {
  type: "opencode-zen";
  apiKey?: string;
}

export type ProviderCredentials =
  | ClaudeCredentials
  | OpenAiCredentials
  | OpenAiOAuthCredentials
  | GeminiCredentials
  | AntigravityCredentials
  | OllamaCredentials
  | LlamaCppCredentials
  | VllmCredentials
  | OpenAiCompatibleCredentials
  | OpenRouterCredentials
  | OpencodeZenCredentials;

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}
