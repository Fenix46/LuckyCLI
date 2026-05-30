import type { IProvider } from "../../IProvider.js";
import type {
  ContentPart,
  GenerationConfig,
  GenerationResponse,
  Message,
  OpenAiOAuthCredentials,
  ProviderInfo,
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

export type { OpenAiOAuthTokens } from "./tokens.js";

const INFO: ProviderInfo = {
  id: "openai-oauth",
  displayName: "ChatGPT",
  availableModels: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-4o"],
  defaultModel: "gpt-5.5",
  supportsStreaming: true,
  supportsVision: true,
  supportsTools: true,
};

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
  max_output_tokens?: number;
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
}

export class OpenAiOAuthProvider implements IProvider {
  readonly info = INFO;
  private tokens: OpenAiOAuthTokens;
  private refreshPromise: Promise<OpenAiOAuthTokens> | undefined;

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
    const res = await fetch(CODEX_API_ENDPOINT, {
      method: "POST",
      headers: await this.authHeaders(),
      body: JSON.stringify(buildRequestBody(messages, config, false)),
      signal: config.abortSignal,
    });
    if (!res.ok) {
      throw new Error(`ChatGPT API error (${res.status}): ${await res.text()}`);
    }
    return fromResponse((await res.json()) as Record<string, unknown>);
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

        if (event.type === "response.completed" && event.usage) {
          usage = {
            inputTokens: event.usage.input_tokens,
            outputTokens: event.usage.output_tokens,
          };
          emittedFinal = true;
          yield {
            finishReason: hasToolCalls ? "tool_calls" : "stop",
            usage,
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
    return undefined;
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.ensureFreshToken();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
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
    ...(config.maxTokens !== undefined ? { max_output_tokens: config.maxTokens } : {}),
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

function fromResponse(data: Record<string, unknown>): GenerationResponse {
  const output =
    (data.output as
      | Array<{
          type: string;
          text?: string;
          name?: string;
          call_id?: string;
          arguments?: string;
        }>
      | undefined) ?? [];
  const content: ContentPart[] = [];

  for (const item of output) {
    if ((item.type === "message" || item.type === "text") && item.text) {
      content.push({ type: "text", text: item.text });
    }
    if (item.type === "function_call") {
      content.push({
        type: "tool_call",
        id: item.call_id ?? "",
        name: item.name ?? "",
        arguments: parseArgs(item.arguments ?? "{}"),
      });
    }
  }

  const usage = data.usage as
    | { input_tokens?: number; output_tokens?: number }
    | undefined;
  return {
    content,
    finishReason: content.some((part) => part.type === "tool_call")
      ? "tool_calls"
      : "stop",
    ...(usage
      ? {
          usage: {
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
          },
        }
      : {}),
    rawMetadata: data,
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
