import OpenAI from "openai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAiProvider } from "./OpenAiProvider.js";

const createMock = vi.fn().mockResolvedValue({
  choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1 },
});

vi.mock("openai", () => {
  const OpenAI = vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: createMock,
      },
    },
    models: {
      list: vi.fn(),
    },
  }));
  return { default: OpenAI };
});

describe("OpenAiProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps canonical tool calls and results to chat completion messages", async () => {
    const provider = new OpenAiProvider({ type: "openai", apiKey: "test-key" });

    await provider.generate(
      [
        { role: "user", content: [{ type: "text", text: "read file" }] },
        {
          role: "assistant",
          content: [
            {
              type: "tool_call",
              id: "call_1",
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
              toolCallId: "call_1",
              name: "read_file",
              content: "contents",
            },
          ],
        },
      ],
      { model: "gpt-test", systemPrompt: "Be concise." },
    );

    expect(OpenAI).toHaveBeenCalledWith({ apiKey: "test-key" });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: "system", content: "Be concise." },
          { role: "user", content: "read file" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "read_file",
                  arguments: JSON.stringify({ path: "README.md" }),
                },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call_1",
            content: "contents",
          },
        ],
      }),
      expect.any(Object),
    );
  });
});
