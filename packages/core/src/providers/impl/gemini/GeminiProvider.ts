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
import { providerInfo } from "../../catalog.js";
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
import { refreshAccessToken } from "./GoogleAuthHelper.js";
import { loadStoredConfig, saveStoredConfig } from "../../../config/store.js";
import { CodeAssistClient } from "./CodeAssistClient.js";

const INFO: ProviderInfo = providerInfo("gemini");
const SYNTHETIC_THOUGHT_SIGNATURE = "skip_thought_signature_validator";

type CodeAssistPart = Part & { thoughtSignature?: string };

export class GeminiProvider implements IProvider {
  readonly info = INFO;
  private client!: GoogleGenAI;
  private readonly codeAssistClient: CodeAssistClient | undefined;
  private readonly credentials: GeminiCredentials;

  constructor(credentials: GeminiCredentials) {
    this.credentials = credentials;
    this.client = this.createClient();
    this.codeAssistClient =
      credentials.authMethod === "oauth"
        ? new CodeAssistClient(() => this.currentAccessToken())
        : undefined;
  }

  private createClient(): GoogleGenAI {
    if (this.credentials.authMethod === "vertex") {
      return new GoogleGenAI({
        vertexai: true,
        project: this.credentials.projectId || undefined,
        location: this.credentials.location || undefined,
      });
    } else {
      return new GoogleGenAI({ apiKey: this.credentials.apiKey || "" });
    }
  }

  private async currentAccessToken(): Promise<string> {
    await this.ensureValidAuth();
    if (!this.credentials.accessToken) {
      throw new Error("Missing Google OAuth access token.");
    }
    return this.credentials.accessToken;
  }

  private async ensureValidAuth(): Promise<void> {
    if (this.credentials.authMethod === "oauth" && this.credentials.refreshToken) {
      try {
        const newToken = await refreshAccessToken(this.credentials.refreshToken);
        if (newToken && newToken !== this.credentials.accessToken) {
          this.credentials.accessToken = newToken;
          this.client = this.createClient();
          
          const cfg = loadStoredConfig();
          if (cfg.credentials?.gemini && cfg.credentials.gemini.type === "gemini") {
            cfg.credentials.gemini = {
              ...(cfg.credentials.gemini as GeminiCredentials),
              accessToken: newToken,
            };
            saveStoredConfig(cfg);
          }
        }
      } catch (e) {
        // Fallback to existing token if refresh fails
      }
    }
  }

  async generate(
    messages: Message[],
    config: GenerationConfig,
  ): Promise<GenerationResponse> {
    const model = config.model || INFO.defaultModel;
    const response = this.codeAssistClient
      ? await this.codeAssistClient.generateContent({
          model,
          contents: toCodeAssistContents(messages),
          ...codeAssistOptions(config),
        })
      : await (async () => {
          await this.ensureValidAuth();
          return this.client.models.generateContent({
            model,
            contents: toGeminiContents(messages),
            config: buildConfig(config),
          });
        })();

    const content = contentFromResponse(response);
    const hasToolCalls = content.some((p) => p.type === "tool_call");
    const rawReason = response.candidates?.[0]?.finishReason;
    const finishReason = hasToolCalls ? "tool_calls" : mapFinishReason(rawReason);

    return {
      content,
      finishReason,
      usage: usageOf(response),
      rawMetadata: response,
    };
  }

  async *generateStream(
    messages: Message[],
    config: GenerationConfig,
  ): AsyncGenerator<StreamChunk> {
    const model = config.model || INFO.defaultModel;
    const stream = this.codeAssistClient
      ? this.codeAssistClient.generateContentStream({
          model,
          contents: toCodeAssistContents(messages),
          ...codeAssistOptions(config),
        })
      : await (async () => {
          await this.ensureValidAuth();
          return this.client.models.generateContentStream({
            model,
            contents: toGeminiContents(messages),
            config: buildConfig(config),
          });
        })();

    let finishReason: FinishReason = "stop";
    let usage: TokenUsage | undefined;
    let hasToolCalls = false;

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) yield { textDelta: text };

      for (const fc of chunk.functionCalls ?? []) {
        hasToolCalls = true;
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

    if (hasToolCalls) {
      finishReason = "tool_calls";
    }

    yield usage ? { finishReason, usage } : { finishReason };
  }

  async countTokens(
    messages: Message[],
    config: GenerationConfig,
  ): Promise<TokenUsage | undefined> {
    const model = config.model || INFO.defaultModel;
    const result = this.codeAssistClient
      ? await this.codeAssistClient.countTokens(
          model,
          toGeminiContents(messages),
          config.abortSignal,
        )
      : await (async () => {
          await this.ensureValidAuth();
          return this.client.models.countTokens({
            model,
            contents: toGeminiContents(messages),
          });
        })();
    return { inputTokens: result.totalTokens ?? 0, outputTokens: 0 };
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      if (this.codeAssistClient) {
        await this.codeAssistClient.generateContent({
          model: INFO.defaultModel,
          contents: [{ role: "user", parts: [{ text: "ping" }] }],
        });
      } else {
        await this.ensureValidAuth();
        await this.client.models.generateContent({
          model: INFO.defaultModel,
          contents: [{ role: "user", parts: [{ text: "ping" }] }],
        });
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

}

function codeAssistOptions(config: GenerationConfig) {
  const built = buildConfig(config);
  const generationConfig: Record<string, unknown> = {};
  if ("temperature" in built) generationConfig.temperature = built.temperature;
  if ("topP" in built) generationConfig.topP = built.topP;
  if ("maxOutputTokens" in built) {
    generationConfig.maxOutputTokens = built.maxOutputTokens;
  }
  if ("stopSequences" in built) {
    generationConfig.stopSequences = built.stopSequences;
  }

  return {
    ...(built.systemInstruction
      ? {
          systemInstruction: {
            role: "user",
            parts: [{ text: String(built.systemInstruction) }],
          },
        }
      : {}),
    ...(built.tools ? { tools: built.tools } : {}),
    ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
    ...(config.abortSignal ? { abortSignal: config.abortSignal } : {}),
  };
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
                parameters: toGeminiSchema(t.parameters) as Record<
                  string,
                  unknown
                >,
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

function toCodeAssistContents(messages: Message[]): Content[] {
  return ensureActiveLoopThoughtSignatures(toGeminiContents(messages));
}

function ensureActiveLoopThoughtSignatures(contents: Content[]): Content[] {
  let activeLoopStartIndex = -1;
  for (let i = contents.length - 1; i >= 0; i--) {
    const content = contents[i];
    if (!content) continue;
    if (content.role === "user" && content.parts?.some((part) => part.text)) {
      activeLoopStartIndex = i;
      break;
    }
  }

  if (activeLoopStartIndex === -1) return contents;

  const out = contents.slice();
  for (let i = activeLoopStartIndex; i < out.length; i++) {
    const content = out[i];
    if (!content) continue;
    if (content.role !== "model" || !content.parts) continue;

    const callIndex = content.parts.findIndex((part) => part.functionCall);
    if (callIndex < 0) continue;

    const part = content.parts[callIndex] as CodeAssistPart | undefined;
    if (!part) continue;
    if (part.thoughtSignature) continue;

    const parts = content.parts.slice();
    parts[callIndex] = {
      ...part,
      thoughtSignature: SYNTHETIC_THOUGHT_SIGNATURE,
    } as CodeAssistPart;
    out[i] = { ...content, parts };
  }
  return out;
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
          name: part.name,
          response: part.isError
            ? { error: part.content }
            : { output: part.content },
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

/**
 * Gemini's function-declaration parameters accept only a restricted OpenAPI-3
 * schema subset. zod-to-json-schema emits valid JSON Schema that includes keys
 * Gemini rejects with a 400 (notably `additionalProperties` and `$schema`), so
 * we deep-clone and keep only the supported keys.
 */
const GEMINI_SCHEMA_KEYS = new Set([
  "type",
  "format",
  "title",
  "description",
  "nullable",
  "enum",
  "items",
  "properties",
  "required",
  "minItems",
  "maxItems",
  "anyOf",
  "default",
]);

function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema === null || typeof schema !== "object") return schema;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (!GEMINI_SCHEMA_KEYS.has(key)) continue;
    if (key === "properties" && value && typeof value === "object") {
      const props: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(
        value as Record<string, unknown>,
      )) {
        props[propName] = toGeminiSchema(propSchema);
      }
      out[key] = props;
    } else if (key === "items") {
      out[key] = toGeminiSchema(value);
    } else if (key === "anyOf") {
      out[key] = Array.isArray(value) ? value.map(toGeminiSchema) : value;
    } else {
      out[key] = value;
    }
  }
  return out;
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
