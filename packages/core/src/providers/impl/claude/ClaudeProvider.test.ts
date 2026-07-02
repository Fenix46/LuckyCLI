import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeProvider } from "./ClaudeProvider.js";

const { refreshClaudeOAuthTokenMock } = vi.hoisted(() => ({
  refreshClaudeOAuthTokenMock: vi.fn(),
}));

vi.mock("./oauth.js", async () => {
  const actual = await vi.importActual<typeof import("./oauth.js")>("./oauth.js");
  return {
    ...actual,
    refreshClaudeOAuthToken: refreshClaudeOAuthTokenMock,
  };
});

const createMock = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: "ok" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1, output_tokens: 1 },
});
const countTokensMock = vi.fn().mockResolvedValue({ input_tokens: 7 });
const streamMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  const Anthropic = vi.fn().mockImplementation(() => ({
    messages: {
      create: createMock,
      countTokens: countTokensMock,
      stream: streamMock,
    },
  }));
  return { default: Anthropic };
});

/**
 * Minimal stand-in for the SDK's MessageStream: async-iterates the given
 * events, optionally throwing `error` afterwards, and resolves finalMessage.
 */
function makeFakeStream(
  events: unknown[],
  final?: unknown,
  error?: unknown,
) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
      if (error) throw error;
    },
    finalMessage: async () => final,
  };
}

describe("ClaudeProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshClaudeOAuthTokenMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes config systemPrompt to generation requests", async () => {
    const provider = new ClaudeProvider({ type: "claude", apiKey: "test-key" });

    await provider.generate(
      [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      { model: "claude-test", systemPrompt: "Be concise." },
    );

    expect(Anthropic).toHaveBeenCalledWith({ apiKey: "test-key" });
    // The system prompt is sent as a cached block so each step re-reads it at
    // cache-read price instead of re-billing the whole prefix.
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        system: [
          { type: "text", text: "Be concise.", cache_control: { type: "ephemeral" } },
        ],
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "hello", cache_control: { type: "ephemeral" } },
            ],
          },
        ],
      }),
      expect.any(Object),
    );
  });

  it("uses Anthropic bearer auth for Claude OAuth credentials", async () => {
    const provider = new ClaudeProvider({
      type: "claude",
      authMethod: "oauth",
      accessToken: "oauth-access-token",
      refreshToken: "oauth-refresh-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    await provider.generate(
      [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      { model: "claude-test" },
    );

    expect(Anthropic).toHaveBeenCalledWith({
      authToken: "oauth-access-token",
      defaultQuery: { beta: "true" },
      defaultHeaders: expect.objectContaining({
        "anthropic-beta": expect.stringContaining("oauth-2025-04-20"),
        "anthropic-dangerous-direct-browser-access": "true",
        "anthropic-version": "2023-06-01",
        "x-app": "cli",
      }),
    });
  });

  it("exposes Claude runtime context metadata in api-key mode too", async () => {
    const provider = new ClaudeProvider({ type: "claude", authMethod: "api_key", apiKey: "test-key" });

    expect(provider.info.models?.["claude-sonnet-5"]).toMatchObject({
      contextWindow: 1_000_000,
      maxOutputTokens: 64_000,
      source: "provider",
    });
  });

  it("maps Claude effort into output_config and sends adaptive thinking when enabled", async () => {
    const provider = new ClaudeProvider({
      type: "claude",
      authMethod: "oauth",
      accessToken: "oauth-access-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    await provider.generate(
      [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      { model: "claude-opus-4-8", reasoningEffort: "xhigh", thinkingEnabled: true },
    );

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        output_config: { effort: "max" },
        thinking: { type: "adaptive" },
      }),
      expect.any(Object),
    );
  });

  it("omits Claude effort and thinking for unsupported models", async () => {
    const provider = new ClaudeProvider({
      type: "claude",
      authMethod: "oauth",
      accessToken: "oauth-access-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    await provider.generate(
      [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      { model: "claude-haiku-4-5-20251001", reasoningEffort: "high", thinkingEnabled: true },
    );

    const request = createMock.mock.calls[0]?.[0];
    expect(request.output_config).toBeUndefined();
    expect(request.thinking).toBeUndefined();
  });

  it("counts OAuth context via an inference probe instead of count_tokens", async () => {
    const provider = new ClaudeProvider({
      type: "claude",
      authMethod: "oauth",
      accessToken: "oauth-access-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    // OAuth cannot use the /count_tokens endpoint, so we probe with a
    // max_tokens:1 inference request and read its input usage.
    const usage = await provider.countTokens(
      [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      { model: "claude-test" },
    );
    expect(usage).toEqual({ inputTokens: 1, outputTokens: 0 });
    expect(countTokensMock).not.toHaveBeenCalled();
    const probe = createMock.mock.calls.at(-1)?.[0];
    expect(probe).toMatchObject({ model: "claude-haiku-4-5-20251001", max_tokens: 1 });
  });

  it("sends Claude Code billing system block for OAuth requests", async () => {
    const provider = new ClaudeProvider({
      type: "claude",
      authMethod: "oauth",
      accessToken: "oauth-access-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    await provider.generate(
      [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      { model: "claude-test", systemPrompt: "Be concise." },
    );

    const request = createMock.mock.calls[0]?.[0];
    // Last system block carries the cache breakpoint covering the whole prefix.
    expect(request.system).toEqual([
      {
        type: "text",
        text: "x-anthropic-billing-header: cc_version=2.1.198.cea; cc_entrypoint=cli; cch=d1656;",
      },
      { type: "text", text: "Be concise.", cache_control: { type: "ephemeral" } },
    ]);
  });

  it("reads Claude OAuth usage status", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          account: { email: "user@example.com" },
          organization: {
            name: "Test Org",
            organization_type: "claude_pro",
            billing_type: "stripe_subscription",
            rate_limit_tier: "default_claude_ai",
            has_extra_usage_enabled: true,
            subscription_status: "active",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          organization_name: "Test Org",
          organization_uuid: "org-123",
          organization_role: "admin",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          five_hour: {
            utilization: 44,
            resets_at: "2026-05-31T17:39:59.859397+00:00",
          },
          seven_day: {
            utilization: 9,
            resets_at: "2026-06-06T11:59:59.859419+00:00",
          },
          seven_day_oauth_apps: null,
          seven_day_opus: null,
          seven_day_sonnet: null,
          extra_usage: {
            is_enabled: true,
            monthly_limit: 4250,
            used_credits: 0,
            utilization: null,
            currency: "EUR",
            disabled_reason: null,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          eligible: true,
          remaining_passes: 3,
          referral_code_details: {
            campaign: "claude_code_guest_pass_a47c",
            referral_link: "https://claude.ai/referral/xPabIykAZQ",
          },
          referrer_reward: {
            amount_minor_units: 1000,
            currency: "EUR",
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ClaudeProvider({
      type: "claude",
      authMethod: "oauth",
      accessToken: "oauth-access-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    const status = await provider.getStatus();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/api/oauth/usage",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          accept: "application/json, text/plain, */*",
          Authorization: "Bearer oauth-access-token",
          "anthropic-beta": "oauth-2025-04-20",
          "Content-Type": "application/json",
          "User-Agent": "claude-cli/2.1.198 (external, cli)",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/api/oauth/organizations/org-123/referral/eligibility?campaign=claude_code_guest_pass",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer oauth-access-token",
          "anthropic-client-platform": "claude_code_cli",
          "anthropic-version": "2023-06-01",
          "x-organization-uuid": "org-123",
        }),
      }),
    );
    expect(status.account).toBe("user@example.com");
    expect(status.subscription).toBe("pro");
    expect(status.tier).toBe("default_claude_ai");
    expect(status.quotas).toEqual([
      {
        label: "5h limit",
        remaining: "56% available (44% used)",
        resetTime: "2026-05-31T17:39:59.859397+00:00",
        tokenType: "5h limit",
      },
      {
        label: "weekly limit",
        remaining: "91% available (9% used)",
        resetTime: "2026-06-06T11:59:59.859419+00:00",
        tokenType: "weekly limit",
      },
    ]);
    expect(status.notes).toContain("extra usage enabled");
    expect(status.notes).toContain("extra usage: enabled, monthly limit 4250 EUR, used 0 EUR");
    expect(status.notes).toContain("guest pass eligible: yes");
    expect(status.notes).toContain("guest passes remaining: 3");
    expect(status.notes).toContain("guest pass reward: 10 EUR");
  });

  it("refreshes Claude OAuth credentials after an authentication error and retries", async () => {
    refreshClaudeOAuthTokenMock.mockResolvedValue({
      accessToken: "refreshed-access-token",
      refreshToken: "oauth-refresh-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    createMock
      .mockRejectedValueOnce({
        status: 401,
        message: "Invalid authentication credentials",
        error: { type: "authentication_error", message: "Invalid authentication credentials" },
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      });

    const provider = new ClaudeProvider({
      type: "claude",
      authMethod: "oauth",
      accessToken: "stale-access-token",
      refreshToken: "oauth-refresh-token",
    });

    const response = await provider.generate(
      [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      { model: "claude-test" },
    );

    expect(response.content).toEqual([{ type: "text", text: "ok" }]);
    expect(refreshClaudeOAuthTokenMock).toHaveBeenCalledWith("oauth-refresh-token");
    expect(Anthropic).toHaveBeenLastCalledWith(
      expect.objectContaining({
        authToken: "refreshed-access-token",
      }),
    );
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("recovers from truncated tool-call JSON instead of failing the turn", async () => {
    streamMock.mockReturnValueOnce(
      makeFakeStream(
        [
          {
            type: "content_block_start",
            index: 0,
            content_block: { type: "tool_use", id: "t1", name: "echo" },
          },
          // max_tokens cut the arguments mid-object: invalid JSON.
          { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"value": "x' } },
          { type: "content_block_stop", index: 0 },
        ],
        { stop_reason: "max_tokens", usage: { input_tokens: 1, output_tokens: 1 } },
      ),
    );
    const provider = new ClaudeProvider({ type: "claude", apiKey: "test-key" });

    const chunks = [];
    for await (const chunk of provider.generateStream(
      [{ role: "user", content: [{ type: "text", text: "go" }] }],
      { model: "claude-test" },
    )) {
      chunks.push(chunk);
    }

    const toolCall = chunks.find((c) => c.toolCall)?.toolCall;
    expect(toolCall).toMatchObject({ id: "t1", name: "echo", arguments: {} });
  });

  it("retries a stream auth error only when nothing was yielded yet", async () => {
    refreshClaudeOAuthTokenMock.mockResolvedValue({
      accessToken: "refreshed-access-token",
      refreshToken: "oauth-refresh-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    const authError = {
      status: 401,
      message: "Invalid authentication credentials",
      error: { type: "authentication_error", message: "Invalid authentication credentials" },
    };

    // Case 1: failure before any chunk -> transparent retry.
    streamMock
      .mockReturnValueOnce(makeFakeStream([], undefined, authError))
      .mockReturnValueOnce(
        makeFakeStream(
          [{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } }],
          { stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } },
        ),
      );
    const provider = new ClaudeProvider({
      type: "claude",
      authMethod: "oauth",
      accessToken: "stale-access-token",
      refreshToken: "oauth-refresh-token",
    });
    const texts = [];
    for await (const chunk of provider.generateStream(
      [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      { model: "claude-test" },
    )) {
      if (chunk.textDelta) texts.push(chunk.textDelta);
    }
    expect(texts).toEqual(["ok"]);
    expect(streamMock).toHaveBeenCalledTimes(2);

    // Case 2: failure after a chunk was yielded -> no replay (it would
    // duplicate output); the error surfaces instead.
    streamMock.mockReset();
    streamMock.mockReturnValueOnce(
      makeFakeStream(
        [{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial" } }],
        undefined,
        authError,
      ),
    );
    const consume = async () => {
      for await (const _chunk of provider.generateStream(
        [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        { model: "claude-test" },
      )) {
        // drain
      }
    };
    await expect(consume()).rejects.toThrow(/authentication|401/i);
    expect(streamMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes OpenAPI boolean exclusive minimums for Claude tools", async () => {
    const provider = new ClaudeProvider({ type: "claude", apiKey: "test-key" });

    await provider.generate([{ role: "user", content: [{ type: "text", text: "run" }] }], {
      model: "claude-test",
      tools: [
        {
          name: "exec",
          description: "Run command",
          parameters: {
            type: "object",
            properties: {
              timeoutMs: {
                type: "integer",
                minimum: 0,
                exclusiveMinimum: true,
              },
            },
          },
        },
      ],
    });

    const request = createMock.mock.calls[0]?.[0];
    expect(request.tools[0].input_schema.properties.timeoutMs).toEqual({
      type: "integer",
      exclusiveMinimum: 0,
    });
  });

  it("surfaces Anthropic rate-limit response headers", async () => {
    createMock.mockRejectedValueOnce({
      status: 429,
      message: "429 Error",
      request_id: "req_123",
      error: { type: "rate_limit_error", message: "Error" },
      headers: {
        "anthropic-ratelimit-unified-status": "rejected",
        "anthropic-ratelimit-unified-5h-status": "rejected",
        "anthropic-ratelimit-unified-5h-reset": "1780249200",
        "anthropic-ratelimit-unified-overage-status": "rejected",
        "anthropic-ratelimit-unified-overage-disabled-reason": "out_of_credits",
      },
    });
    const provider = new ClaudeProvider({ type: "claude", apiKey: "test-key" });

    await expect(
      provider.generate([{ role: "user", content: [{ type: "text", text: "hi" }] }], {
        model: "claude-test",
      }),
    ).rejects.toThrow(
      "rate limit: unified rejected | 5h rejected | 5h reset 2026-05-31T17:40:00.000Z | overage rejected | overage reason out_of_credits",
    );
  });

  it("combines config and message system prompts", async () => {
    const provider = new ClaudeProvider({ type: "claude", apiKey: "test-key" });

    await provider.countTokens(
      [
        { role: "system", content: [{ type: "text", text: "Project rules." }] },
        { role: "user", content: [{ type: "text", text: "hello" }] },
      ],
      { model: "claude-test", systemPrompt: "Be concise." },
    );

    expect(countTokensMock).toHaveBeenCalledWith(
      expect.objectContaining({
        system: [
          {
            type: "text",
            text: "Be concise.\nProject rules.",
            cache_control: { type: "ephemeral" },
          },
        ],
      }),
    );
  });

  it("maps canonical tool calls and results to Anthropic content blocks", async () => {
    const provider = new ClaudeProvider({ type: "claude", apiKey: "test-key" });

    await provider.generate(
      [
        { role: "user", content: [{ type: "text", text: "read file" }] },
        {
          role: "assistant",
          content: [
            {
              type: "tool_call",
              id: "toolu_1",
              name: "read_file",
              arguments: { path: "README.md" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool_result",
              toolCallId: "toolu_1",
              name: "read_file",
              content: "contents",
            },
          ],
        },
      ],
      { model: "claude-test" },
    );

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: "user", content: [{ type: "text", text: "read file" }] },
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_1",
                name: "read_file",
                input: { path: "README.md" },
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_1",
                content: "contents",
                // Moving cache breakpoint on the last block of the transcript.
                cache_control: { type: "ephemeral" },
              },
            ],
          },
        ],
      }),
      expect.any(Object),
    );
  });
});
