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
}

// ─── Provider identity & capabilities ────────────────────────────────────────

export type ProviderId = "claude" | "openai" | "gemini" | "ollama";

export const PROVIDER_IDS: readonly ProviderId[] = [
  "claude",
  "openai",
  "gemini",
  "ollama",
];

export interface ProviderInfo {
  id: ProviderId;
  displayName: string;
  availableModels: string[];
  defaultModel: string;
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsTools: boolean;
}

// ─── Provider credentials (discriminated by provider id) ─────────────────────

export interface ClaudeCredentials {
  type: "claude";
  apiKey: string;
}

export interface OpenAiCredentials {
  type: "openai";
  apiKey: string;
  baseUrl?: string;
}

export interface GeminiCredentials {
  type: "gemini";
  apiKey: string;
}

export interface OllamaCredentials {
  type: "ollama";
  baseUrl: string;
}

export type ProviderCredentials =
  | ClaudeCredentials
  | OpenAiCredentials
  | GeminiCredentials
  | OllamaCredentials;

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}
