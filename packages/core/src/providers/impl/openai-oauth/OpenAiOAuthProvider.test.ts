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
});
