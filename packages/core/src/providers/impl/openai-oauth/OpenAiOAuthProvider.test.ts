import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiOAuthProvider } from "./OpenAiOAuthProvider.js";

describe("OpenAiOAuthProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends ChatGPT OAuth requests with tool history", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [{ type: "message", text: "done" }],
        usage: { input_tokens: 10, output_tokens: 2 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiOAuthProvider({
      type: "openai-oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.now() + 60 * 60 * 1000,
      accountId: "account-1",
    });

    const response = await provider.generate(
      [
        { role: "user", content: [{ type: "text", text: "inspect" }] },
        {
          role: "assistant",
          content: [
            {
              type: "tool_call",
              id: "call_1",
              name: "list_dir",
              arguments: { path: "." },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool_result",
              toolCallId: "call_1",
              name: "list_dir",
              content: "package.json",
            },
          ],
        },
      ],
      { model: "gpt-5.5" },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://chatgpt.com/backend-api/codex/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer access-token",
          "ChatGPT-Account-Id": "account-1",
        }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.input).toEqual([
      { role: "user", content: "inspect" },
      {
        type: "function_call",
        call_id: "call_1",
        name: "list_dir",
        arguments: JSON.stringify({ path: "." }),
      },
      {
        type: "function_call_output",
        call_id: "call_1",
        output: "package.json",
      },
    ]);
    expect(response.content).toEqual([{ type: "text", text: "done" }]);
  });

  it("normalizes OpenAPI boolean exclusive minimums for ChatGPT tools", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiOAuthProvider({
      type: "openai-oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.now() + 60 * 60 * 1000,
    });

    await provider.generate([{ role: "user", content: [{ type: "text", text: "run" }] }], {
      model: "gpt-5.5",
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

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tools[0].parameters.properties.timeoutMs).toEqual({
      type: "integer",
      exclusiveMinimum: 0,
    });
  });

  it("marks streamed function calls as tool_calls finish reason", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(
          encoder.encode(
            [
              'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call_1","name":"list_dir","arguments":"{}"}}',
              'data: {"type":"response.completed","usage":{"input_tokens":5,"output_tokens":1}}',
              "",
            ].join("\n"),
          ),
        );
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: stream,
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiOAuthProvider({
      type: "openai-oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.now() + 60 * 60 * 1000,
    });

    const chunks = [];
    for await (const chunk of provider.generateStream(
      [{ role: "user", content: [{ type: "text", text: "list" }] }],
      { model: "gpt-5.5" },
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      {
        toolCall: {
          type: "tool_call",
          id: "call_1",
          name: "list_dir",
          arguments: {},
        },
      },
      {
        finishReason: "tool_calls",
        usage: { inputTokens: 5, outputTokens: 1 },
      },
    ]);
  });

  it("reads streamed token usage from response payloads", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(
          encoder.encode(
            [
              'data: {"type":"response.output_text.delta","delta":"hello"}',
              'data: {"type":"response.completed","response":{"usage":{"input_tokens":7,"output_tokens":3}}}',
              "",
            ].join("\n"),
          ),
        );
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, body: stream }),
    );

    const provider = new OpenAiOAuthProvider({
      type: "openai-oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.now() + 60 * 60 * 1000,
    });

    const chunks = [];
    for await (const chunk of provider.generateStream(
      [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      { model: "gpt-5.5" },
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { textDelta: "hello" },
      {
        finishReason: "stop",
        usage: { inputTokens: 7, outputTokens: 3 },
      },
    ]);
  });
});
