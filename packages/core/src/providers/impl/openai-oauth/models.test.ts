import { describe, expect, it, vi } from "vitest";
import { fetchCodexModels } from "./models.js";
import type { OpenAiOAuthTokens } from "./tokens.js";

const tokens: OpenAiOAuthTokens = {
  access: "tok",
  refresh: "r",
  expires: Date.now() + 3_600_000,
  accountId: "acct-1",
};

// Trimmed shape of a real /codex/models response.
const FIXTURE = {
  models: [
    {
      slug: "gpt-5.5",
      display_name: "GPT-5.5",
      description: "Frontier model.",
      context_window: 272000,
      max_context_window: 272000,
      support_verbosity: true,
      default_verbosity: "low",
      default_reasoning_level: "xhigh",
      supported_reasoning_levels: [
        { effort: "low", description: "Fast" },
        { effort: "medium", description: "Balanced" },
        { effort: "high", description: "Deep" },
        { effort: "xhigh", description: "Extra deep" },
      ],
    },
    { slug: "gpt-5.4-mini", display_name: "GPT-5.4 mini" }, // sparse entry
    { display_name: "no slug" }, // dropped
  ],
};

function fakeFetch(body: unknown, ok = true, status = 200) {
  return vi.fn(
    async () =>
      ({
        ok,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
      }) as Response,
  ) as unknown as typeof fetch;
}

describe("fetchCodexModels", () => {
  it("maps the backend payload into CodexModel and keeps reasoning levels", async () => {
    const models = await fetchCodexModels(tokens, { fetchImpl: fakeFetch(FIXTURE) });

    expect(models.map((m) => m.slug)).toEqual(["gpt-5.5", "gpt-5.4-mini"]); // entry w/o slug dropped

    const top = models[0]!;
    expect(top.displayName).toBe("GPT-5.5");
    expect(top.contextWindow).toBe(272000);
    expect(top.defaultReasoningLevel).toBe("xhigh");
    expect(top.supportedReasoningLevels.map((l) => l.effort)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);

    // Sparse entry: defaults gracefully, empty reasoning levels.
    const mini = models[1]!;
    expect(mini.displayName).toBe("GPT-5.4 mini");
    expect(mini.supportedReasoningLevels).toEqual([]);
  });

  it("sends auth + client_version and hits the models endpoint", async () => {
    const fetchImpl = fakeFetch(FIXTURE);
    await fetchCodexModels(tokens, { fetchImpl, clientVersion: "9.9.9" });

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/backend-api/codex/models");
    expect(url).toContain("client_version=9.9.9");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer tok",
      "chatgpt-account-id": "acct-1",
    });
  });

  it("throws on a non-200 response", async () => {
    await expect(
      fetchCodexModels(tokens, { fetchImpl: fakeFetch({ error: "nope" }, false, 401) }),
    ).rejects.toThrow(/Codex models endpoint failed \(401\)/);
  });
});
