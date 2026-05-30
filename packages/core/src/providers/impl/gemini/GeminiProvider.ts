/**
 * Gemini provider — adapts Google's `@google/genai` SDK to the canonical
 * IProvider. The only place Gemini SDK types are allowed to appear.
 *
 * NOTE: structurally complete but not yet exercised against the live API.
 */

import {
  GoogleGenAI,
  type Content,
  type GenerateContentResponse,
  type Part,
} from "@google/genai";
import type { IProvider } from "../../IProvider.js";
import type {
  ContentPart,
  FinishReason,
  GeminiCredentials,
  GenerationConfig,
  GenerationResponse,
  Message,
  ProviderInfo,
  StreamChunk,
  TokenUsage,
} from "../../types.js";

const INFO: ProviderInfo = {
  id: "gemini",
  displayName: "Google Gemini",
  availableModels: ["gemini-2.0-flash", "gemini-2.0-pro", "gemini-1.5-pro"],
  defaultModel: "gemini-2.0-flash",
  supportsStreaming: true,
  supportsVision: true,
  supportsTools: true,
};

export class GeminiProvider implements IProvider {
  readonly info = INFO;
  private readonly client: GoogleGenAI;

  constructor(credentials: GeminiCredentials) {
    this.client = new GoogleGenAI({ apiKey: credentials.apiKey });
  }

  async generate(
    messages: Message[],
    config: GenerationConfig,
  ): Promise<GenerationResponse> {
    const response = await this.client.models.generateContent({
      model: config.model || INFO.defaultModel,
      contents: toGeminiContents(messages),
      config: buildConfig(config),
    });

    return {
      content: contentFromResponse(response),
      finishReason: mapFinishReason(response.candidates?.[0]?.finishReason),
      usage: usageOf(response),
      rawMetadata: response,
    };
  }

  async *generateStream(
    messages: Message[],
    config: GenerationConfig,
  ): AsyncGenerator<StreamChunk> {
    const stream = await this.client.models.generateContentStream({
      model: config.model || INFO.defaultModel,
      contents: toGeminiContents(messages),
      config: buildConfig(config),
    });

    let finishReason: FinishReason = "stop";
    let usage: TokenUsage | undefined;

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) yield { textDelta: text };

      for (const fc of chunk.functionCalls ?? []) {
        yield {
          toolCall: {
            type: "tool_call",
            id: fc.id ?? `${fc.name}-${Date.now()}`,
            name: fc.name ?? "",
            arguments: (fc.args as Record<string, unknown>) ?? {},
          },
        };
      }

      const candidateReason = chunk.candidates?.[0]?.finishReason;
      if (candidateReason) finishReason = mapFinishReason(candidateReason);
      const u = usageOf(chunk);
      if (u) usage = u;
    }

    yield usage ? { finishReason, usage } : { finishReason };
  }

  async countTokens(
    messages: Message[],
    config: GenerationConfig,
  ): Promise<TokenUsage | undefined> {
    const result = await this.client.models.countTokens({
      model: config.model || INFO.defaultModel,
      contents: toGeminiContents(messages),
    });
    return { inputTokens: result.totalTokens ?? 0, outputTokens: 0 };
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.client.models.generateContent({
        model: INFO.defaultModel,
        contents: [{ role: "user", parts: [{ text: "ping" }] }],
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }
}

function buildConfig(config: GenerationConfig) {
  return {
    ...(config.systemPrompt
      ? { systemInstruction: config.systemPrompt }
      : {}),
    ...(config.temperature !== undefined
      ? { temperature: config.temperature }
      : {}),
    ...(config.topP !== undefined ? { topP: config.topP } : {}),
    ...(config.maxTokens ? { maxOutputTokens: config.maxTokens } : {}),
    ...(config.stopSequences ? { stopSequences: config.stopSequences } : {}),
    ...(config.tools && config.tools.length > 0
      ? {
          tools: [
            {
              functionDeclarations: config.tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters as Record<string, unknown>,
              })),
            },
          ],
        }
      : {}),
  };
}

function toGeminiContents(messages: Message[]): Content[] {
  const contents: Content[] = [];
  for (const msg of messages) {
    // System prompt is passed via config.systemInstruction, not as a turn.
    if (msg.role === "system") continue;
    const role = msg.role === "assistant" ? "model" : "user";
    contents.push({ role, parts: msg.content.map(toGeminiPart) });
  }
  return contents;
}

function toGeminiPart(part: ContentPart): Part {
  switch (part.type) {
    case "text":
      return { text: part.text };
    case "image":
      return { inlineData: { mimeType: part.mimeType, data: part.data } };
    case "tool_call":
      return {
        functionCall: { id: part.id, name: part.name, args: part.arguments },
      };
    case "tool_result":
      return {
        functionResponse: {
          id: part.toolCallId,
          name: part.toolCallId,
          response: { content: part.content },
        },
      };
  }
}

function contentFromResponse(response: GenerateContentResponse): ContentPart[] {
  const content: ContentPart[] = [];
  const text = response.text;
  if (text) content.push({ type: "text", text });
  for (const fc of response.functionCalls ?? []) {
    content.push({
      type: "tool_call",
      id: fc.id ?? `${fc.name}-${Date.now()}`,
      name: fc.name ?? "",
      arguments: (fc.args as Record<string, unknown>) ?? {},
    });
  }
  return content;
}

function usageOf(response: GenerateContentResponse): TokenUsage | undefined {
  const u = response.usageMetadata;
  if (!u) return undefined;
  return {
    inputTokens: u.promptTokenCount ?? 0,
    outputTokens: u.candidatesTokenCount ?? 0,
    ...(u.cachedContentTokenCount != null
      ? { cacheReadTokens: u.cachedContentTokenCount }
      : {}),
  };
}

function mapFinishReason(reason: string | undefined): FinishReason {
  switch (reason) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "max_tokens";
    case "SAFETY":
    case "RECITATION":
      return "content_filter";
    case undefined:
      return "stop";
    default:
      return "unknown";
  }
}
