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
      defaultHeaders: { "anthropic-beta": "oauth-2025-04-20" },
    });
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
