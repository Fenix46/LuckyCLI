import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiOAuthProvider } from "./OpenAiOAuthProvider.js";

/** Build a ReadableStream of SSE `data:` lines, as the Codex endpoint returns. */
function sseStream(...lines: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode([...lines, ""].join("\n")));
      controller.close();
    },
  });
}

describe("OpenAiOAuthProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends ChatGPT OAuth requests with tool history", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: sseStream(
        'data: {"type":"response.output_text.delta","delta":"done"}',
        'data: {"type":"response.completed","usage":{"input_tokens":10,"output_tokens":2}}',
      ),
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

  it("captures encrypted reasoning and replays it to the same model only", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => ({
      ok: true,
      body: sseStream(
        'data: {"type":"response.output_item.done","item":{"type":"reasoning","id":"rs_1","summary":[{"type":"summary_text","text":"plan"}],"encrypted_content":"ENC"}}',
        'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"c1","name":"read_file","arguments":"{}"}}',
        'data: {"type":"response.completed"}',
      ),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiOAuthProvider({
      type: "openai-oauth",
      access: "t",
      refresh: "r",
      expires: Date.now() + 3_600_000,
    });

    const chunks = [];
    for await (const chunk of provider.generateStream([{ role: "user", content: [{ type: "text", text: "hi" }] }], {
      model: "gpt-5.5",
    })) {
      chunks.push(chunk);
    }
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).include).toEqual(["reasoning.encrypted_content"]);
    const part = chunks.find((c) => c.reasoningPart)?.reasoningPart;
    expect(part).toMatchObject({ type: "reasoning", provider: "openai-oauth" });

    const history = [
      { role: "user" as const, content: [{ type: "text" as const, text: "hi" }] },
      {
        role: "assistant" as const,
        content: [part!, { type: "tool_call" as const, id: "c1", name: "read_file", arguments: {} }],
      },
      {
        role: "tool" as const,
        content: [{ type: "tool_result" as const, toolCallId: "c1", name: "read_file", content: "ok" }],
      },
    ];
    await provider.generate(history, { model: "gpt-5.5" });
    const replayed = JSON.parse(fetchMock.mock.calls[1][1].body).input;
    expect(replayed[1]).toEqual({
      type: "reasoning",
      summary: [{ type: "summary_text", text: "plan" }],
      encrypted_content: "ENC",
    });
    expect(replayed[2]).toMatchObject({ type: "function_call", call_id: "c1" });

    // Encrypted reasoning is bound to its model: a model switch drops it.
    await provider.generate(history, { model: "gpt-5.4-mini" });
    const switched = JSON.parse(fetchMock.mock.calls[2][1].body).input;
    expect(switched.some((item: { type?: string }) => item.type === "reasoning")).toBe(false);
  });

  it("pins the conversation to a prompt cache and reports cached input", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => ({
      ok: true,
      body: sseStream(
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":1200,"output_tokens":5,"input_tokens_details":{"cached_tokens":1000}}}}',
      ),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiOAuthProvider({
      type: "openai-oauth",
      access: "t",
      refresh: "r",
      expires: Date.now() + 3_600_000,
    });

    const response = await provider.generate([{ role: "user", content: [{ type: "text", text: "hi" }] }], {
      model: "gpt-5.5",
      promptCacheKey: "conv-1",
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).prompt_cache_key).toBe("conv-1");
    expect(response.usage).toEqual({ inputTokens: 1200, outputTokens: 5, cacheReadTokens: 1000 });
  });

  it("sends reasoning.effort when set, and omits it when not", async () => {
    // Fresh stream per call: generate() is invoked twice and a ReadableStream
    // can only be read once.
    const fetchMock = vi.fn().mockImplementation(async () => ({
      ok: true,
      body: sseStream('data: {"type":"response.completed"}'),
    }));
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

  it("never forwards max_output_tokens (Codex rejects it)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: sseStream('data: {"type":"response.completed"}'),
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
      maxTokens: 2048,
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("max_output_tokens");
  });

  it("normalizes OpenAPI boolean exclusive minimums for ChatGPT tools", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: sseStream('data: {"type":"response.completed"}'),
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
