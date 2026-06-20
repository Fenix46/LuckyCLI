import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchOpencodeZenModels,
  fetchOpenRouterModels,
} from "./openai-models.js";
import { OPENROUTER_BASE_URL } from "./openrouter/OpenRouterProvider.js";
import {
  OPENCODE_ZEN_BASE_URL,
  OPENCODE_ZEN_PUBLIC_KEY,
} from "./opencode-zen/OpencodeZenProvider.js";

function mockModels(ids: string[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: ids.map((id) => ({ id })) }),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("gateway model discovery", () => {
  it("fetches OpenRouter models from its /models endpoint with the key", async () => {
    const fetchMock = mockModels(["anthropic/claude-sonnet-4-6"]);
    vi.stubGlobal("fetch", fetchMock);

    const models = await fetchOpenRouterModels("sk-or-test");

    expect(models).toEqual([{ id: "anthropic/claude-sonnet-4-6" }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${OPENROUTER_BASE_URL}/models`);
    expect(init.headers).toEqual({ authorization: "Bearer sk-or-test" });
  });

  it("uses the public key for zen when none is supplied", async () => {
    const fetchMock = mockModels(["claude-sonnet-4-6"]);
    vi.stubGlobal("fetch", fetchMock);

    const models = await fetchOpencodeZenModels();

    expect(models).toEqual([{ id: "claude-sonnet-4-6" }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${OPENCODE_ZEN_BASE_URL}/models`);
    expect(init.headers).toEqual({
      authorization: `Bearer ${OPENCODE_ZEN_PUBLIC_KEY}`,
    });
  });

  it("reads OpenRouter context windows (top_provider preferred)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              id: "anthropic/claude-sonnet-4-6",
              context_length: 200000,
              top_provider: { context_length: 180000 },
            },
            { id: "x/no-ctx" },
          ],
        }),
      }),
    );

    const models = await fetchOpenRouterModels("k");

    expect(models).toEqual([
      { id: "anthropic/claude-sonnet-4-6", contextWindow: 180000 },
      { id: "x/no-ctx" },
    ]);
  });

  it("returns [] when the gateway is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
    );

    expect(await fetchOpenRouterModels("k")).toEqual([]);
  });
});
