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
  ProviderQuotaStatus,
  ProviderStatus,
  StreamChunk,
  TextPart,
  TokenUsage,
} from "../../types.js";
import {
  CLAUDE_OAUTH_BETA_HEADER,
  claudeContextWindowForModel,
  fetchClaudeOAuthProfile,
  fetchClaudeOAuthRoles,
  fetchClaudeOAuthUsage,
  refreshClaudeOAuthToken,
  subscriptionType,
  type ClaudeOAuthTokens,
  type ClaudeOAuthUsage,
  type ClaudeOAuthUsageWindow,
} from "./oauth.js";

const INFO: ProviderInfo = providerInfo("claude");
const CLAUDE_CODE_BETA_HEADER = [
  "claude-code-20250219",
  CLAUDE_OAUTH_BETA_HEADER,
  "interleaved-thinking-2025-05-14",
  "redact-thinking-2026-02-12",
  "context-management-2025-06-27",
  "advanced-tool-use-2025-11-20",
].join(",");
const CLAUDE_CODE_BILLING_SYSTEM =
  "x-anthropic-billing-header: cc_version=2.1.158.cea; cc_entrypoint=cli; cch=d1656;";
// Small/fast model used for OAuth token-count probes (see countTokensViaProbe).
const CLAUDE_COUNT_PROBE_MODEL = "claude-haiku-4-5-20251001";

export class ClaudeProvider implements IProvider {
  info: ProviderInfo;
  private client: Anthropic;
  private refreshPromise: Promise<ClaudeOAuthTokens> | undefined;

  constructor(
    private credentials: ClaudeCredentials,
    private readonly onTokensRefreshed?: (credentials: ClaudeCredentials) => void,
  ) {
    this.info = this.createProviderInfo(credentials);
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
    try {
      const response = await this.client.messages.create(
        {
          model: config.model || INFO.defaultModel,
          max_tokens: config.maxTokens ?? 8192,
          ...this.systemParam(system),
          messages: anthropicMessages,
          ...buildOptions(config),
        },
        { signal: config.abortSignal },
      );
      return fromAnthropicResponse(response);
    } catch (e) {
      throw anthropicError(e);
    }
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
    try {
      const stream = this.client.messages.stream(
        {
          model: config.model || INFO.defaultModel,
          max_tokens: config.maxTokens ?? 8192,
          ...this.systemParam(system),
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
    } catch (e) {
      throw anthropicError(e);
    }
  }

  async countTokens(
    messages: Message[],
    config: GenerationConfig,
  ): Promise<TokenUsage | undefined> {
    await this.ensureFreshToken();
    // OAuth tokens cannot call the dedicated /count_tokens endpoint (it is not
    // covered by the user:inference scope). Instead we probe with a real
    // inference request capped at one output token on the small/fast model and
    // read the input usage it reports back — the same approach claude-code uses
    // as its count fallback. The model only affects price/latency here, not the
    // input token count of the transcript, so we always use Haiku.
    if (this.credentials.authMethod === "oauth") {
      return this.countTokensViaProbe(messages, config);
    }
    const { system, messages: anthropicMessages } = toAnthropic(
      messages,
      config.systemPrompt,
    );
    try {
      const result = await this.client.messages.countTokens({
        model: config.model || INFO.defaultModel,
        ...this.systemParam(system),
        messages: anthropicMessages,
      });
      return { inputTokens: result.input_tokens, outputTokens: 0 };
    } catch (e) {
      throw anthropicError(e);
    }
  }

  /**
   * Count input tokens for a transcript without the /count_tokens endpoint, by
   * issuing a minimal inference request (max_tokens: 1) and reading usage.
   * Used for OAuth, where /count_tokens is unavailable.
   */
  private async countTokensViaProbe(
    messages: Message[],
    config: GenerationConfig,
  ): Promise<TokenUsage | undefined> {
    const { system, messages: anthropicMessages } = toAnthropic(
      messages,
      config.systemPrompt,
    );
    // The API rejects an empty messages array; a single throwaway message
    // gives a stable lower-bound count when there is nothing to measure yet.
    const probeMessages: Anthropic.Messages.MessageParam[] =
      anthropicMessages.length > 0
        ? anthropicMessages
        : [{ role: "user", content: "count" }];
    try {
      const response = await this.client.messages.create(
        {
          model: CLAUDE_COUNT_PROBE_MODEL,
          max_tokens: 1,
          ...this.systemParam(system),
          messages: probeMessages,
          ...buildOptions(config),
        },
        { signal: config.abortSignal },
      );
      const usage = usageOf(response.usage);
      if (!usage) return undefined;
      // Output is meaningless for a probe; report only the input side so the
      // caller's used-context math reflects the transcript, not our 1 token.
      return {
        inputTokens: usage.inputTokens,
        outputTokens: 0,
        ...(usage.cacheReadTokens != null ? { cacheReadTokens: usage.cacheReadTokens } : {}),
        ...(usage.cacheWriteTokens != null ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
      };
    } catch (e) {
      throw anthropicError(e);
    }
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
      const [profile, roles, usage] = credentials.accessToken
        ? await Promise.all([
            fetchClaudeOAuthProfile(credentials.accessToken).catch(() => undefined),
            fetchClaudeOAuthRoles(credentials.accessToken).catch(() => undefined),
            fetchClaudeOAuthUsage(credentials.accessToken).catch(() => undefined),
          ])
        : [undefined, undefined, undefined];
      const sub =
        subscriptionType(profile?.organization?.organization_type) ??
        credentials.subscriptionType;
      const tier = profile?.organization?.rate_limit_tier ?? credentials.rateLimitTier;
      const quotas = usageQuotas(usage);
      const usageNotes = extraUsageNotes(usage);
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
        ...(quotas.length ? { quotas } : {}),
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
          ...usageNotes,
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

  private createProviderInfo(credentials: ClaudeCredentials): ProviderInfo {
    if (credentials.authMethod !== "oauth") return INFO;
    const models = Object.fromEntries(
      INFO.availableModels.map((model) => [
        model,
        {
          ...(INFO.models?.[model] ?? { id: model }),
          contextWindow: claudeContextWindowForModel(model),
          source: "provider" as const,
        },
      ]),
    );
    return { ...INFO, models };
  }

  private createClient(credentials: ClaudeCredentials): Anthropic {
    if (credentials.authMethod === "oauth") {
      if (!credentials.accessToken) {
        throw new Error("Claude OAuth credentials are missing an access token.");
      }
      return new Anthropic({
        authToken: credentials.accessToken,
        defaultQuery: { beta: "true" },
        defaultHeaders: {
          "anthropic-beta": CLAUDE_CODE_BETA_HEADER,
          "anthropic-dangerous-direct-browser-access": "true",
          "anthropic-version": "2023-06-01",
          "User-Agent": "claude-cli/2.1.158 (external, cli)",
          "x-app": "cli",
        },
      });
    }

    if (!credentials.apiKey) {
      throw new Error("Claude API key credentials are missing an API key.");
    }
    return new Anthropic({ apiKey: credentials.apiKey });
  }

  private systemParam(
    system: string | undefined,
  ): { system?: string | Anthropic.Messages.TextBlockParam[] } {
    if (this.credentials.authMethod !== "oauth") {
      return system ? { system } : {};
    }

    const blocks: Anthropic.Messages.TextBlockParam[] = [
      { type: "text", text: CLAUDE_CODE_BILLING_SYSTEM },
    ];
    if (system) blocks.push({ type: "text", text: system });
    return { system: blocks };
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
        this.info = this.createProviderInfo(this.credentials);
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
            input_schema: toClaudeJsonSchema(t.parameters) as Anthropic.Messages.Tool["input_schema"],
          })),
        }
      : {}),
  };
}

function usageQuotas(usage: ClaudeOAuthUsage | undefined): ProviderQuotaStatus[] {
  return [
    usageQuota("5h limit", usage?.five_hour),
    usageQuota("weekly limit", usage?.seven_day),
    usageQuota("weekly OAuth apps", usage?.seven_day_oauth_apps),
    usageQuota("weekly Opus", usage?.seven_day_opus),
    usageQuota("weekly Sonnet", usage?.seven_day_sonnet),
    usageQuota("weekly cowork", usage?.seven_day_cowork),
    usageQuota("weekly omelette", usage?.seven_day_omelette),
  ].filter((quota): quota is ProviderQuotaStatus => Boolean(quota));
}

function usageQuota(
  label: string,
  window: ClaudeOAuthUsageWindow | null | undefined,
): ProviderQuotaStatus | undefined {
  if (!window) return undefined;
  const used =
    typeof window.utilization === "number" && Number.isFinite(window.utilization)
      ? Math.round(window.utilization)
      : undefined;
  return {
    label,
    ...(used !== undefined
      ? { remaining: `${Math.max(0, 100 - used)}% available (${used}% used)` }
      : {}),
    ...(window.resets_at ? { resetTime: window.resets_at } : {}),
    tokenType: label,
  };
}

function extraUsageNotes(usage: ClaudeOAuthUsage | undefined): string[] {
  const extra = usage?.extra_usage;
  if (!extra) return [];

  const currency = extra.currency ? ` ${extra.currency}` : "";
  const parts = [
    extra.is_enabled === undefined ? undefined : extra.is_enabled ? "enabled" : "disabled",
    extra.monthly_limit !== undefined
      ? `monthly limit ${extra.monthly_limit}${currency}`
      : undefined,
    extra.used_credits !== undefined ? `used ${extra.used_credits}${currency}` : undefined,
    typeof extra.utilization === "number" && Number.isFinite(extra.utilization)
      ? `${Math.round(extra.utilization)}% used`
      : undefined,
    extra.disabled_reason ? `reason ${extra.disabled_reason}` : undefined,
  ].filter((part): part is string => Boolean(part));

  return parts.length ? [`extra usage: ${parts.join(", ")}`] : [];
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

function toClaudeJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
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

function anthropicError(error: unknown): Error {
  const details = anthropicErrorDetails(error);
  if (!details) return error instanceof Error ? error : new Error(String(error));
  return new Error(details);
}

function anthropicErrorDetails(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as {
    status?: number;
    message?: string;
    request_id?: string | null;
    headers?: Record<string, string | undefined>;
    error?: { type?: string; message?: string };
  };
  if (!e.status && !e.message) return undefined;

  const headers = e.headers ?? {};
  const rateLimitParts = [
    headerPart(headers, "anthropic-ratelimit-unified-status", "unified"),
    headerPart(headers, "anthropic-ratelimit-unified-reset", "reset"),
    headerPart(headers, "anthropic-ratelimit-unified-5h-status", "5h"),
    headerPart(headers, "anthropic-ratelimit-unified-5h-utilization", "5h used"),
    headerPart(headers, "anthropic-ratelimit-unified-5h-reset", "5h reset"),
    headerPart(headers, "anthropic-ratelimit-unified-7d-status", "7d"),
    headerPart(headers, "anthropic-ratelimit-unified-7d-utilization", "7d used"),
    headerPart(headers, "anthropic-ratelimit-unified-7d-reset", "7d reset"),
    headerPart(headers, "anthropic-ratelimit-unified-overage-status", "overage"),
    headerPart(
      headers,
      "anthropic-ratelimit-unified-overage-disabled-reason",
      "overage reason",
    ),
    headerPart(
      headers,
      "anthropic-ratelimit-unified-representative-claim",
      "claim",
    ),
  ].filter(Boolean);

  const bodyMessage =
    e.error?.message && e.error.message !== "Error" ? e.error.message : undefined;
  return [
    e.status ? `Anthropic API error (${e.status})` : "Anthropic API error",
    bodyMessage ?? e.message,
    e.request_id ? `request ${e.request_id}` : undefined,
    rateLimitParts.length ? `rate limit: ${rateLimitParts.join(" | ")}` : undefined,
  ]
    .filter(Boolean)
    .join(" - ");
}

function headerPart(
  headers: Record<string, string | undefined>,
  key: string,
  label: string,
): string | undefined {
  const value = headers[key];
  if (value === undefined) return undefined;
  if (key.endsWith("-reset")) return `${label} ${formatReset(value)}`;
  return `${label} ${value}`;
}

function formatReset(value: string): string {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return value;
  return new Date(seconds * 1000).toISOString();
}
