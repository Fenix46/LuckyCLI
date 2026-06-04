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

  it("sends reasoning.effort when set, and omits it when not", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ output: [{ type: "message", text: "ok" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiOAuthProvider({
      type: "openai-oauth",
      access: "t",
      refresh: "r",
      expires: Date.now() + 3_600_000,
    });

    await provider.generate([{ role: "user", content: [{ type: "text", text: "hi" }] }], {
      model: "gpt-5.5",
      reasoningEffort: "high",
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning).toEqual({ effort: "high" });

    await provider.generate([{ role: "user", content: [{ type: "text", text: "hi" }] }], {
      model: "gpt-5.5",
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).reasoning).toBeUndefined();
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

  it("reads ChatGPT OAuth usage status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        email: "user@example.com",
        plan_type: "plus",
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: {
            used_percent: 1,
            reset_at: 1780254390,
          },
          secondary_window: {
            used_percent: 41,
            reset_at: 1780585340,
          },
        },
        credits: {
          has_credits: false,
          unlimited: false,
          overage_limit_reached: false,
          balance: "0",
        },
        rate_limit_reset_credits: {
          available_count: 0,
        },
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

    const status = await provider.getStatus();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://chatgpt.com/backend-api/wham/usage",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          accept: "*/*",
          Authorization: "Bearer access-token",
          "User-Agent":
            "codex-tui/0.135.0 (Mac OS; arm64) Apple_Terminal (codex-tui; 0.135.0)",
          "chatgpt-account-id": "account-1",
        }),
      }),
    );
    expect(status.account).toBe("user@example.com");
    expect(status.subscription).toBe("plus");
    expect(status.tier).toBe("plus");
    expect(status.quotas).toEqual([
      {
        label: "5h limit",
        remaining: "99% available (1% used)",
        resetTime: "2026-05-31T19:06:30.000Z",
        tokenType: "5h limit",
      },
      {
        label: "weekly limit",
        remaining: "59% available (41% used)",
        resetTime: "2026-06-04T15:02:20.000Z",
        tokenType: "weekly limit",
      },
    ]);
    expect(status.notes).toContain("credits: no credits, balance 0");
    expect(status.notes).toContain("rate limit reset credits: 0");
  });
});
