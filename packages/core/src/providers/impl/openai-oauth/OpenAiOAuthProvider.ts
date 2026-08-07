import type { IProvider } from "../../IProvider.js";
import type {
  ContentPart,
  GenerationConfig,
  GenerationResponse,
  Message,
  OpenAiOAuthCredentials,
  ProviderInfo,
  ProviderStatus,
  StreamChunk,
  TextPart,
  TokenUsage,
} from "../../types.js";
import {
  CODEX_API_ENDPOINT,
  isExpired,
  refreshAccessToken,
  tokensToOAuth,
  type OpenAiOAuthTokens,
} from "./tokens.js";
import { ensureChatGptCa } from "./chatgpt-tls.js";

export type { OpenAiOAuthTokens } from "./tokens.js";

const INFO: ProviderInfo = {
  id: "openai-oauth",
  displayName: "ChatGPT",
  // Bootstrap list only — the live model list comes from /codex/models
  // (fetchCodexModels) once authenticated.
  availableModels: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-4o"],
  defaultModel: "gpt-5.5",
  supportsStreaming: true,
  supportsVision: true,
  supportsTools: true,
  usageTokensIncludeCache: true,
};

const CHATGPT_USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const CHATGPT_USAGE_USER_AGENT =
  "codex-tui/0.135.0 (Mac OS; arm64) Apple_Terminal (codex-tui; 0.135.0)";

type ResponsesInputItem =
  | {
      role: "user" | "assistant" | "system";
      content: string | Array<{ type: "text"; text: string }>;
    }
  | {
      type: "function_call";
      call_id: string;
      name: string;
      arguments: string;
    }
  | {
      type: "function_call_output";
      call_id: string;
      output: string;
    };

interface ResponsesTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface ResponsesRequest {
  model: string;
  input: ResponsesInputItem[];
  instructions: string;
  store: boolean;
  stream: boolean;
  reasoning?: { effort: string };
  tools?: ResponsesTool[];
}

interface ResponsesStreamEvent {
  type: string;
  delta?: string;
  item?: {
    type: string;
    name?: string;
    call_id?: string;
    arguments?: string;
  };
  usage?: { input_tokens: number; output_tokens: number };
  response?: {
    usage?: { input_tokens?: number; output_tokens?: number } | null;
  };
}

interface ChatGptUsageWindow {
  used_percent?: number;
  limit_window_seconds?: number;
  reset_after_seconds?: number;
  reset_at?: number;
}

interface ChatGptUsageResponse {
  user_id?: string;
  account_id?: string;
  email?: string;
  plan_type?: string;
  rate_limit?: {
    allowed?: boolean;
    limit_reached?: boolean;
    primary_window?: ChatGptUsageWindow;
    secondary_window?: ChatGptUsageWindow;
  };
  credits?: {
    has_credits?: boolean;
    unlimited?: boolean;
    overage_limit_reached?: boolean;
    balance?: string;
  };
  spend_control?: {
    reached?: boolean;
    individual_limit?: string | null;
  };
  rate_limit_reached_type?: string | null;
  rate_limit_reset_credits?: {
    available_count?: number;
  };
}

export class OpenAiOAuthProvider implements IProvider {
  readonly info = INFO;
  private tokens: OpenAiOAuthTokens;
  private refreshPromise: Promise<OpenAiOAuthTokens> | undefined;
  // Cached from the last stream's response.completed event. No dedicated
  // counting endpoint exists, so agent.ts gets this on the next countTokens() call.
  private _lastUsage: TokenUsage | undefined;

  constructor(
    credentials: OpenAiOAuthCredentials,
    private readonly onTokensRefreshed?: (tokens: OpenAiOAuthTokens) => void,
  ) {
    this.tokens = {
      access: credentials.access,
      refresh: credentials.refresh,
      expires: credentials.expires,
      ...(credentials.accountId ? { accountId: credentials.accountId } : {}),
    };
  }

  async generate(
    messages: Message[],
    config: GenerationConfig,
  ): Promise<GenerationResponse> {
    // The Codex endpoint rejects non-streaming requests ("Stream must be set to
    // true"), so a real non-streaming call is impossible. Drive the stream and
    // aggregate it into a single GenerationResponse for callers that want one
    // (e.g. compaction's summarizeMessages).
    const content: ContentPart[] = [];
    let text = "";
    let usage: TokenUsage | undefined;
    let finishReason: GenerationResponse["finishReason"] = "stop";

    for await (const chunk of this.generateStream(messages, config)) {
      if (chunk.textDelta) text += chunk.textDelta;
      if (chunk.toolCall) content.push(chunk.toolCall);
      if (chunk.usage) usage = chunk.usage;
      if (chunk.finishReason) finishReason = chunk.finishReason;
    }

    if (text) content.unshift({ type: "text", text });
    return {
      content,
      finishReason,
      ...(usage ? { usage } : {}),
    };
  }

  async *generateStream(
    messages: Message[],
    config: GenerationConfig,
  ): AsyncGenerator<StreamChunk> {
    const res = await fetch(CODEX_API_ENDPOINT, {
      method: "POST",
      headers: await this.authHeaders(),
      body: JSON.stringify(buildRequestBody(messages, config, true)),
      signal: config.abortSignal,
    });
    if (!res.ok) {
      throw new Error(`ChatGPT API error (${res.status}): ${await res.text()}`);
    }
    if (!res.body) throw new Error("ChatGPT API returned an empty stream.");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let usage: TokenUsage | undefined;
    let hasToolCalls = false;
    let emittedFinal = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data || data === "[DONE]") continue;

        let event: ResponsesStreamEvent;
        try {
          event = JSON.parse(data) as ResponsesStreamEvent;
        } catch {
          continue;
        }

        if (event.type === "response.output_text.delta" && event.delta) {
          yield { textDelta: event.delta };
        }

        // Codex spends seconds reasoning before the first text token, emitting
        // only `response.reasoning*` events. Surface them as an activity signal
        // (no text) so a long thinking phase doesn't look like a hung stream.
        if (event.type.startsWith("response.reasoning")) {
          yield { reasoning: true };
        }

        if (event.type === "response.output_item.done" && event.item?.type === "function_call") {
          hasToolCalls = true;
          yield {
            toolCall: {
              type: "tool_call",
              id: event.item.call_id ?? "",
              name: event.item.name ?? "",
              arguments: parseArgs(event.item.arguments ?? "{}"),
            },
          };
        }

        if (event.type === "response.completed") {
          const eventUsage = event.usage ?? event.response?.usage ?? undefined;
          if (eventUsage) {
            usage = {
              inputTokens: eventUsage.input_tokens ?? 0,
              outputTokens: eventUsage.output_tokens ?? 0,
            };
            this._lastUsage = usage;
          }
          emittedFinal = true;
          yield {
            finishReason: hasToolCalls ? "tool_calls" : "stop",
            ...(usage ? { usage } : {}),
          };
        }
      }
    }

    if (!emittedFinal) {
      yield {
        finishReason: hasToolCalls ? "tool_calls" : "stop",
        ...(usage ? { usage } : {}),
      };
    }
  }

  async countTokens(): Promise<TokenUsage | undefined> {
    return this._lastUsage;
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.ensureFreshToken();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async getStatus(): Promise<ProviderStatus> {
    const tokens = await this.ensureFreshToken();
    const base = {
      provider: this.info.id,
      displayName: this.info.displayName,
      authType: "oauth",
      ...(tokens.accountId ? { account: tokens.accountId } : {}),
    };

    let usage: ChatGptUsageResponse | undefined;
    try {
      usage = await fetchChatGptUsage(tokens);
    } catch (e) {
      return {
        ...base,
        notes: [
          "ChatGPT usage status is not available from the wham usage endpoint.",
          `Usage endpoint error: ${describeError(e)}`,
        ],
      };
    }

    const quotas = [
      quotaFromWindow("5h limit", usage.rate_limit?.primary_window),
      quotaFromWindow("weekly limit", usage.rate_limit?.secondary_window),
    ].filter((quota): quota is NonNullable<typeof quota> => Boolean(quota));

    const notes = usageNotes(usage);
    return {
      ...base,
      ...(usage.email ?? tokens.accountId ? { account: usage.email ?? tokens.accountId } : {}),
      ...(usage.plan_type ? { subscription: usage.plan_type, tier: usage.plan_type } : {}),
      ...(quotas.length ? { quotas } : {}),
      ...(notes.length ? { notes } : {}),
    };
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const tokens = await this.ensureFreshToken();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokens.access}`,
      originator: "luckycli",
      ...(tokens.accountId ? { "ChatGPT-Account-Id": tokens.accountId } : {}),
    };
  }

  private async ensureFreshToken(): Promise<OpenAiOAuthTokens> {
    if (!isExpired(this.tokens)) return this.tokens;
    this.refreshPromise ??= refreshAccessToken(this.tokens.refresh)
      .then((raw) => {
        const refreshed = tokensToOAuth(raw);
        refreshed.accountId ??= this.tokens.accountId;
        this.tokens = refreshed;
        this.onTokensRefreshed?.(refreshed);
        return refreshed;
      })
      .finally(() => {
        this.refreshPromise = undefined;
      });
    return this.refreshPromise;
  }
}

async function fetchChatGptUsage(tokens: OpenAiOAuthTokens): Promise<ChatGptUsageResponse> {
  ensureChatGptCa();
  const res = await fetch(CHATGPT_USAGE_ENDPOINT, {
    method: "GET",
    headers: {
      accept: "*/*",
      Authorization: `Bearer ${tokens.access}`,
      "User-Agent": CHATGPT_USAGE_USER_AGENT,
      ...(tokens.accountId ? { "chatgpt-account-id": tokens.accountId } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`ChatGPT usage endpoint failed (${res.status}): ${await res.text()}`);
  }
  return res.json() as Promise<ChatGptUsageResponse>;
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (cause instanceof Error && cause.message) return `${error.message}: ${cause.message}`;
  if (cause && typeof cause === "object" && "message" in cause) {
    return `${error.message}: ${String((cause as { message: unknown }).message)}`;
  }
  return error.message;
}

function quotaFromWindow(label: string, window: ChatGptUsageWindow | undefined) {
  if (!window) return undefined;
  const usedPercent = clampPercent(window.used_percent);
  return {
    label,
    ...(usedPercent !== undefined
      ? { remaining: `${100 - usedPercent}% available (${usedPercent}% used)` }
      : {}),
    ...(window.reset_at ? { resetTime: formatUnixSeconds(window.reset_at) } : {}),
    tokenType: label,
  };
}

function clampPercent(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatUnixSeconds(value: number): string | undefined {
  if (!Number.isFinite(value)) return undefined;
  return new Date(value * 1000).toISOString();
}

function usageNotes(usage: ChatGptUsageResponse): string[] {
  const notes: string[] = [];
  if (usage.rate_limit?.allowed === false) notes.push("ChatGPT usage is currently not allowed.");
  if (usage.rate_limit?.limit_reached) notes.push("ChatGPT rate limit is currently reached.");
  if (usage.rate_limit_reached_type) {
    notes.push(`rate limit reached type: ${usage.rate_limit_reached_type}`);
  }
  if (usage.credits) {
    const creditParts = [
      usage.credits.unlimited ? "unlimited credits" : undefined,
      usage.credits.has_credits ? "credits available" : "no credits",
      usage.credits.balance !== undefined ? `balance ${usage.credits.balance}` : undefined,
      usage.credits.overage_limit_reached ? "overage limit reached" : undefined,
    ].filter(Boolean);
    if (creditParts.length) notes.push(`credits: ${creditParts.join(", ")}`);
  }
  if (usage.spend_control?.reached) notes.push("spend control limit reached.");
  if (usage.rate_limit_reset_credits?.available_count !== undefined) {
    notes.push(`rate limit reset credits: ${usage.rate_limit_reset_credits.available_count}`);
  }
  return notes;
}

function buildRequestBody(
  messages: Message[],
  config: GenerationConfig,
  stream: boolean,
): ResponsesRequest {
  const input: ResponsesInputItem[] = [];
  const systemParts: string[] = [];

  if (config.systemPrompt) systemParts.push(config.systemPrompt);

  for (const msg of messages) {
    if (msg.role === "system") {
      const text = textOf(msg.content);
      if (text) systemParts.push(text);
      continue;
    }

    if (msg.role === "assistant") {
      const text = textOf(msg.content);
      if (text) input.push({ role: "assistant", content: text });
      for (const part of msg.content) {
        if (part.type !== "tool_call") continue;
        input.push({
          type: "function_call",
          call_id: part.id,
          name: part.name,
          arguments: JSON.stringify(part.arguments),
        });
      }
      continue;
    }

    for (const part of msg.content) {
      if (part.type === "tool_result") {
        input.push({
          type: "function_call_output",
          call_id: part.toolCallId,
          output: part.content,
        });
      }
    }

    const text = textOf(msg.content);
    if (text) input.push({ role: "user", content: text });
  }

  return {
    model: config.model || INFO.defaultModel,
    input,
    instructions: systemParts.join("\n") || "You are a helpful AI coding assistant.",
    store: false,
    stream,
    // The Codex endpoint rejects max_output_tokens ("Unsupported parameter"),
    // so config.maxTokens (e.g. from compaction) must not be forwarded.
    ...(config.reasoningEffort ? { reasoning: { effort: config.reasoningEffort } } : {}),
    ...(config.tools?.length
      ? {
          tools: config.tools.map((tool) => ({
            type: "function" as const,
            name: tool.name,
            description: tool.description,
            parameters: toOpenAiJsonSchema(tool.parameters),
          })),
        }
      : {}),
  };
}


function textOf(content: ContentPart[]): string {
  return content
    .filter((part): part is TextPart => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toOpenAiJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return normalizeJsonSchema(schema) as Record<string, unknown>;
}

function normalizeJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJsonSchema);
  if (!value || typeof value !== "object") return value;

  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(input)) {
    if (key === "$schema") continue;

    if (key === "exclusiveMinimum" && typeof child === "boolean") {
      if (child === true && typeof input.minimum === "number") {
        out.exclusiveMinimum = input.minimum;
      }
      continue;
    }

    if (key === "exclusiveMaximum" && typeof child === "boolean") {
      if (child === true && typeof input.maximum === "number") {
        out.exclusiveMaximum = input.maximum;
      }
      continue;
    }

    if (
      (key === "minimum" && input.exclusiveMinimum === true) ||
      (key === "maximum" && input.exclusiveMaximum === true)
    ) {
      continue;
    }

    out[key] = normalizeJsonSchema(child);
  }
  return out;
}
