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
  ProviderStatus,
  StreamChunk,
  TextPart,
  TokenUsage,
} from "../../types.js";
import {
  CLAUDE_OAUTH_BETA_HEADER,
  fetchClaudeOAuthProfile,
  fetchClaudeOAuthRoles,
  refreshClaudeOAuthToken,
  subscriptionType,
  type ClaudeOAuthTokens,
} from "./oauth.js";

const INFO: ProviderInfo = providerInfo("claude");

export class ClaudeProvider implements IProvider {
  readonly info = INFO;
  private client: Anthropic;
  private refreshPromise: Promise<ClaudeOAuthTokens> | undefined;

  constructor(
    private credentials: ClaudeCredentials,
    private readonly onTokensRefreshed?: (credentials: ClaudeCredentials) => void,
  ) {
    this.client = this.createClient(credentials);
  }

  async generate(
    messages: Message[],
    config: GenerationConfig,
  ): Promise<GenerationResponse> {
    await this.ensureFreshToken();
    const { system, messages: anthropicMessages } = toAnthropic(
      messages,
      config.systemPrompt,
    );
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
    await this.ensureFreshToken();
    const { system, messages: anthropicMessages } = toAnthropic(
      messages,
      config.systemPrompt,
    );
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
    await this.ensureFreshToken();
    const { system, messages: anthropicMessages } = toAnthropic(
      messages,
      config.systemPrompt,
    );
    const result = await this.client.messages.countTokens({
      model: config.model || INFO.defaultModel,
      ...(system ? { system } : {}),
      messages: anthropicMessages,
    });
    return { inputTokens: result.input_tokens, outputTokens: 0 };
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.ensureFreshToken();
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

  async getStatus(): Promise<ProviderStatus> {
    if (this.credentials.authMethod === "oauth") {
      const credentials = await this.ensureFreshToken();
      const [profile, roles] = credentials.accessToken
        ? await Promise.all([
            fetchClaudeOAuthProfile(credentials.accessToken).catch(() => undefined),
            fetchClaudeOAuthRoles(credentials.accessToken).catch(() => undefined),
          ])
        : [undefined, undefined];
      const sub =
        subscriptionType(profile?.organization?.organization_type) ??
        credentials.subscriptionType;
      const tier = profile?.organization?.rate_limit_tier ?? credentials.rateLimitTier;
      return {
        provider: this.info.id,
        displayName: this.info.displayName,
        authType: "oauth",
        ...(profile?.account?.email ?? credentials.email
          ? { account: profile?.account?.email ?? credentials.email }
          : {}),
        ...(profile?.organization?.name ?? roles?.organization_name ?? credentials.organizationName
          ? { project: profile?.organization?.name ?? roles?.organization_name ?? credentials.organizationName }
          : {}),
        ...(sub ? { subscription: sub } : {}),
        ...(tier ?? sub ? { tier: tier ?? sub } : {}),
        notes: [
          profile?.organization?.subscription_status
            ? `subscription status: ${profile.organization.subscription_status}`
            : undefined,
          profile?.organization?.billing_type ?? credentials.billingType
            ? `billing: ${profile?.organization?.billing_type ?? credentials.billingType}`
            : undefined,
          profile?.organization?.has_extra_usage_enabled === true
            ? "extra usage enabled"
            : undefined,
          roles?.organization_role ? `organization role: ${roles.organization_role}` : undefined,
          roles?.workspace_role ? `workspace role: ${roles.workspace_role}` : undefined,
          sub ? undefined : "Claude OAuth account does not report a Pro/Max/Team/Enterprise subscription.",
        ].filter((note): note is string => Boolean(note)),
      };
    }

    return {
      provider: this.info.id,
      displayName: this.info.displayName,
      authType: "api key",
      notes: ["Account, subscription, and provider quota windows are not exposed by this provider API."],
    };
  }

  private createClient(credentials: ClaudeCredentials): Anthropic {
    if (credentials.authMethod === "oauth") {
      if (!credentials.accessToken) {
        throw new Error("Claude OAuth credentials are missing an access token.");
      }
      return new Anthropic({
        authToken: credentials.accessToken,
        defaultHeaders: { "anthropic-beta": CLAUDE_OAUTH_BETA_HEADER },
      });
    }

    if (!credentials.apiKey) {
      throw new Error("Claude API key credentials are missing an API key.");
    }
    return new Anthropic({ apiKey: credentials.apiKey });
  }

  private async ensureFreshToken(): Promise<ClaudeCredentials> {
    if (this.credentials.authMethod !== "oauth") return this.credentials;
    if (!this.credentials.expiresAt || this.credentials.expiresAt - Date.now() >= 5 * 60 * 1000) {
      return this.credentials;
    }
    if (!this.credentials.refreshToken) return this.credentials;

    this.refreshPromise ??= refreshClaudeOAuthToken(this.credentials.refreshToken)
      .then((tokens) => {
        this.credentials = { ...this.credentials, ...tokens, type: "claude", authMethod: "oauth" };
        this.client = this.createClient(this.credentials);
        this.onTokensRefreshed?.(this.credentials);
        return tokens;
      })
      .finally(() => {
        this.refreshPromise = undefined;
      });
    await this.refreshPromise;
    return this.credentials;
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

function toAnthropic(
  messages: Message[],
  systemPrompt?: string,
): {
  system?: string;
  messages: Anthropic.Messages.MessageParam[];
} {
  const systemParts: string[] = [];
  const result: Anthropic.Messages.MessageParam[] = [];

  if (systemPrompt) systemParts.push(systemPrompt);

  for (const msg of messages) {
    if (msg.role === "system") {
      const text = msg.content
        .filter((p): p is TextPart => p.type === "text")
        .map((p) => p.text)
        .join("\n");
      if (text) systemParts.push(text);
      continue;
    }

    const content = msg.content.map(toAnthropicBlock);
    const role: "user" | "assistant" =
      msg.role === "assistant" ? "assistant" : "user";
    result.push({ role, content });
  }

  const system = systemParts.join("\n").trim();
  return system
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
