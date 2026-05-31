/**
 * OpenAI provider — adapts the OpenAI Chat Completions API to the canonical
 * IProvider. The only place OpenAI SDK types are allowed to appear.
 *
 * Subclassed by OllamaProvider, which targets an OpenAI-compatible endpoint.
 */

import OpenAI from "openai";
import type { IProvider } from "../../IProvider.js";
import { providerInfo } from "../../catalog.js";
import type {
  ContentPart,
  FinishReason,
  GenerationConfig,
  GenerationResponse,
  Message,
  OpenAiCredentials,
  ProviderInfo,
  ProviderStatus,
  StreamChunk,
  TextPart,
  TokenUsage,
} from "../../types.js";

const INFO: ProviderInfo = providerInfo("openai");

export class OpenAiProvider implements IProvider {
  readonly info: ProviderInfo = INFO;
  protected readonly client: OpenAI;

  constructor(credentials: OpenAiCredentials) {
    this.client = new OpenAI({
      apiKey: credentials.apiKey,
      ...(credentials.baseUrl ? { baseURL: credentials.baseUrl } : {}),
    });
  }

  async generate(
    messages: Message[],
    config: GenerationConfig,
  ): Promise<GenerationResponse> {
    const response = await this.client.chat.completions.create(
      {
        model: config.model || this.info.defaultModel,
        messages: toOpenAiMessages(messages, config.systemPrompt),
        ...buildOptions(config),
      },
      { signal: config.abortSignal },
    );

    const choice = response.choices[0];
    const content: ContentPart[] = [];
    if (choice?.message.content) {
      content.push({ type: "text", text: choice.message.content });
    }
    for (const call of choice?.message.tool_calls ?? []) {
      if (call.type !== "function") continue;
      content.push({
        type: "tool_call",
        id: call.id,
        name: call.function.name,
        arguments: parseArgs(call.function.arguments),
      });
    }

    return {
      content,
      finishReason: mapFinishReason(choice?.finish_reason ?? null),
      usage: usageOf(response.usage),
      rawMetadata: response,
    };
  }

  async *generateStream(
    messages: Message[],
    config: GenerationConfig,
  ): AsyncGenerator<StreamChunk> {
    const stream = await this.client.chat.completions.create(
      {
        model: config.model || this.info.defaultModel,
        messages: toOpenAiMessages(messages, config.systemPrompt),
        stream: true,
        stream_options: { include_usage: true },
        ...buildOptions(config),
      },
      { signal: config.abortSignal },
    );

    // Tool calls stream as fragments keyed by their array index.
    const toolBuffers = new Map<
      number,
      { id: string; name: string; args: string }
    >();
    let finishReason: FinishReason = "stop";
    let usage: TokenUsage | undefined;

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (choice?.delta?.content) {
        yield { textDelta: choice.delta.content };
      }
      for (const call of choice?.delta?.tool_calls ?? []) {
        const buf = toolBuffers.get(call.index) ?? { id: "", name: "", args: "" };
        if (call.id) buf.id = call.id;
        if (call.function?.name) buf.name = call.function.name;
        if (call.function?.arguments) buf.args += call.function.arguments;
        toolBuffers.set(call.index, buf);
      }
      if (choice?.finish_reason) {
        finishReason = mapFinishReason(choice.finish_reason);
      }
      if (chunk.usage) usage = usageOf(chunk.usage);
    }

    for (const buf of toolBuffers.values()) {
      yield {
        toolCall: {
          type: "tool_call",
          id: buf.id,
          name: buf.name,
          arguments: parseArgs(buf.args),
        },
      };
    }

    yield usage ? { finishReason, usage } : { finishReason };
  }

  async countTokens(): Promise<TokenUsage | undefined> {
    // No dedicated endpoint; usage is reported after generation instead.
    return undefined;
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.client.models.list();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async getStatus(): Promise<ProviderStatus> {
    return {
      provider: this.info.id,
      displayName: this.info.displayName,
      authType: this.info.id === "ollama" ? "local" : "api key",
      notes:
        this.info.id === "ollama"
          ? ["Local provider; account, subscription, and remote quota windows do not apply."]
          : ["Account, subscription, and rolling quota windows are not exposed by this provider API."],
    };
  }
}

function buildOptions(config: GenerationConfig) {
  return {
    ...(config.temperature !== undefined
      ? { temperature: config.temperature }
      : {}),
    ...(config.topP !== undefined ? { top_p: config.topP } : {}),
    ...(config.maxTokens ? { max_tokens: config.maxTokens } : {}),
    ...(config.stopSequences ? { stop: config.stopSequences } : {}),
    ...(config.tools && config.tools.length > 0
      ? {
          tools: config.tools.map((t) => ({
            type: "function" as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          })),
        }
      : {}),
  };
}

function toOpenAiMessages(
  messages: Message[],
  systemPrompt: string | undefined,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (systemPrompt) out.push({ role: "system", content: systemPrompt });

  for (const msg of messages) {
    if (msg.role === "system") {
      const text = msg.content
        .filter((p): p is TextPart => p.type === "text")
        .map((p) => p.text)
        .join("\n");
      if (text) out.push({ role: "system", content: text });
      continue;
    }

    if (msg.role === "assistant") {
      const text = textOf(msg.content);
      const toolCalls = msg.content
        .filter((p) => p.type === "tool_call")
        .map((p) => {
          const tc = p as { id: string; name: string; arguments: unknown };
          return {
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          };
        });
      out.push({
        role: "assistant",
        content: text || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    // user / tool turns
    const textParts: string[] = [];
    for (const part of msg.content) {
      if (part.type === "tool_result") {
        out.push({
          role: "tool",
          tool_call_id: part.toolCallId,
          content: part.content,
        });
      } else if (part.type === "text") {
        textParts.push(part.text);
      }
    }
    if (textParts.length > 0) {
      out.push({ role: "user", content: textParts.join("") });
    }
  }
  return out;
}

function textOf(content: ContentPart[]): string {
  return content
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function usageOf(
  usage: OpenAI.CompletionUsage | undefined,
): TokenUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    ...(usage.prompt_tokens_details?.cached_tokens != null
      ? { cacheReadTokens: usage.prompt_tokens_details.cached_tokens }
      : {}),
  };
}

function mapFinishReason(reason: string | null): FinishReason {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "max_tokens";
    case "tool_calls":
    case "function_call":
      return "tool_calls";
    case "content_filter":
      return "content_filter";
    default:
      return "unknown";
  }
}
