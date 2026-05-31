import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeAssistClient } from "./CodeAssistClient.js";

describe("CodeAssistClient", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses one stable Code Assist session id for a client instance", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ currentTier: {}, cloudaicompanionProject: "p1" }),
      )
      .mockResolvedValueOnce(jsonResponse({ response: { candidates: [] } }))
      .mockResolvedValueOnce(jsonResponse({ response: { candidates: [] } }));

    const client = new CodeAssistClient(() => "access-token");

    await client.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: [{ role: "user", parts: [{ text: "one" }] }],
    });
    await client.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: [{ role: "user", parts: [{ text: "two" }] }],
    });

    const firstGenerateBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    const secondGenerateBody = JSON.parse(fetchMock.mock.calls[2][1].body);

    expect(firstGenerateBody.request.session_id).toBeTruthy();
    expect(secondGenerateBody.request.session_id).toBe(
      firstGenerateBody.request.session_id,
    );
    expect(secondGenerateBody.user_prompt_id).not.toBe(
      firstGenerateBody.user_prompt_id,
    );
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
