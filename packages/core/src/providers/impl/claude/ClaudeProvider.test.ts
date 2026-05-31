import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeProvider } from "./ClaudeProvider.js";

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

describe("ClaudeProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes config systemPrompt to generation requests", async () => {
    const provider = new ClaudeProvider({ type: "claude", apiKey: "test-key" });

    await provider.generate(
      [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      { model: "claude-test", systemPrompt: "Be concise." },
    );

    expect(Anthropic).toHaveBeenCalledWith({ apiKey: "test-key" });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        system: "Be concise.",
        messages: [
          { role: "user", content: [{ type: "text", text: "hello" }] },
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

  it("does not call count_tokens for Claude OAuth credentials", async () => {
    const provider = new ClaudeProvider({
      type: "claude",
      authMethod: "oauth",
      accessToken: "oauth-access-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    await expect(provider.countTokens([], { model: "claude-test" })).resolves.toBeUndefined();
    expect(countTokensMock).not.toHaveBeenCalled();
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
    expect(request.system).toEqual([
      {
        type: "text",
        text: "x-anthropic-billing-header: cc_version=2.1.158.cea; cc_entrypoint=cli; cch=d1656;",
      },
      { type: "text", text: "Be concise." },
    ]);
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
        system: "Be concise.\nProject rules.",
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
              },
            ],
          },
        ],
      }),
      expect.any(Object),
    );
  });
});
