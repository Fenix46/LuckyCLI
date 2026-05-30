/**
 * Claude provider — adapts the Anthropic SDK to/from the canonical IProvider.
 * This is the ONLY place Anthropic types are allowed to appear.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { IProvider } from "../../IProvider.js";
import { providerInfo } from "../../catalog.js";
import type {
  ClaudeCredentials,
  ContentPart,
  FinishReason,
  GenerationConfig,
  GenerationResponse,
  Message,
  ProviderInfo,
  StreamChunk,
  TextPart,
  TokenUsage,
} from "../../types.js";

const INFO: ProviderInfo = providerInfo("claude");

export class ClaudeProvider implements IProvider {
  readonly info = INFO;
  private readonly client: Anthropic;

  constructor(credentials: ClaudeCredentials) {
    this.client = new Anthropic({ apiKey: credentials.apiKey });
  }

  async generate(
    messages: Message[],
    config: GenerationConfig,
  ): Promise<GenerationResponse> {
    const { system, messages: anthropicMessages } = toAnthropic(messages);
    const response = await this.client.messages.create(
      {
        model: config.model || INFO.defaultModel,
        max_tokens: config.maxTokens ?? 8192,
        ...(system ? { system } : {}),
        messages: anthropicMessages,
        ...buildOptions(config),
      },
      { signal: config.abortSignal },
    );
    return fromAnthropicResponse(response);
  }

  async *generateStream(
    messages: Message[],
    config: GenerationConfig,
  ): AsyncGenerator<StreamChunk> {
    const { system, messages: anthropicMessages } = toAnthropic(messages);
    const stream = this.client.messages.stream(
      {
        model: config.model || INFO.defaultModel,
        max_tokens: config.maxTokens ?? 8192,
        ...(system ? { system } : {}),
        messages: anthropicMessages,
        ...buildOptions(config),
      },
      { signal: config.abortSignal },
    );

    // Accumulate streamed JSON arguments per tool_use block by index.
    const toolBuffers = new Map<
      number,
      { id: string; name: string; json: string }
    >();

    for await (const event of stream) {
      switch (event.type) {
        case "content_block_start":
          if (event.content_block.type === "tool_use") {
            toolBuffers.set(event.index, {
              id: event.content_block.id,
              name: event.content_block.name,
              json: "",
            });
          }
          break;
        case "content_block_delta":
          if (event.delta.type === "text_delta") {
            yield { textDelta: event.delta.text };
          } else if (event.delta.type === "input_json_delta") {
            const buf = toolBuffers.get(event.index);
            if (buf) buf.json += event.delta.partial_json;
          }
          break;
        case "content_block_stop": {
          const buf = toolBuffers.get(event.index);
          if (buf) {
            yield {
              toolCall: {
                type: "tool_call",
                id: buf.id,
                name: buf.name,
                arguments: buf.json ? JSON.parse(buf.json) : {},
              },
            };
            toolBuffers.delete(event.index);
          }
          break;
        }
        default:
          break;
      }
    }

    const final = await stream.finalMessage();
    yield { finishReason: mapStopReason(final.stop_reason), usage: usageOf(final.usage) };
  }

  async countTokens(
    messages: Message[],
    config: GenerationConfig,
  ): Promise<TokenUsage | undefined> {
    const { system, messages: anthropicMessages } = toAnthropic(messages);
    const result = await this.client.messages.countTokens({
      model: config.model || INFO.defaultModel,
      ...(system ? { system } : {}),
      messages: anthropicMessages,
    });
    return { inputTokens: result.input_tokens, outputTokens: 0 };
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.client.messages.create({
        model: INFO.defaultModel,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }
}

function buildOptions(config: GenerationConfig) {
  return {
    ...(config.temperature !== undefined
      ? { temperature: config.temperature }
      : {}),
    ...(config.topP !== undefined ? { top_p: config.topP } : {}),
    ...(config.stopSequences ? { stop_sequences: config.stopSequences } : {}),
    ...(config.tools && config.tools.length > 0
      ? {
          tools: config.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters as Anthropic.Messages.Tool["input_schema"],
          })),
        }
      : {}),
  };
}

function toAnthropic(messages: Message[]): {
  system?: string;
  messages: Anthropic.Messages.MessageParam[];
} {
  let system: string | undefined;
  const result: Anthropic.Messages.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      system = msg.content
        .filter((p): p is TextPart => p.type === "text")
        .map((p) => p.text)
        .join("\n");
      continue;
    }

    const content = msg.content.map(toAnthropicBlock);
    const role: "user" | "assistant" =
      msg.role === "assistant" ? "assistant" : "user";
    result.push({ role, content });
  }

  return system !== undefined
    ? { system, messages: result }
    : { messages: result };
}

function toAnthropicBlock(part: ContentPart): Anthropic.Messages.ContentBlockParam {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "image":
      return {
        type: "image",
        source: {
          type: "base64",
          media_type:
            part.mimeType as Anthropic.Messages.Base64ImageSource["media_type"],
          data: part.data,
        },
      };
    case "tool_call":
      return {
        type: "tool_use",
        id: part.id,
        name: part.name,
        input: part.arguments,
      };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: part.toolCallId,
        content: part.content,
        ...(part.isError ? { is_error: true } : {}),
      };
  }
}

function fromAnthropicResponse(
  response: Anthropic.Messages.Message,
): GenerationResponse {
  const content: ContentPart[] = [];
  for (const block of response.content) {
    if (block.type === "text") {
      content.push({ type: "text", text: block.text });
    } else if (block.type === "tool_use") {
      content.push({
        type: "tool_call",
        id: block.id,
        name: block.name,
        arguments: block.input as Record<string, unknown>,
      });
    }
  }
  return {
    content,
    finishReason: mapStopReason(response.stop_reason),
    usage: usageOf(response.usage),
    rawMetadata: response,
  };
}

function usageOf(usage: Anthropic.Messages.Usage | undefined): TokenUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    ...(usage.cache_read_input_tokens != null
      ? { cacheReadTokens: usage.cache_read_input_tokens }
      : {}),
    ...(usage.cache_creation_input_tokens != null
      ? { cacheWriteTokens: usage.cache_creation_input_tokens }
      : {}),
  };
}

function mapStopReason(reason: string | null): FinishReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "max_tokens";
    case "tool_use":
      return "tool_calls";
    default:
      return "unknown";
  }
}
