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
});
