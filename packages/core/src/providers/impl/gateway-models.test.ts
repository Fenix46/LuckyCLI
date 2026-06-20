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

  it("returns [] when the gateway is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
    );

    expect(await fetchOpenRouterModels("k")).toEqual([]);
  });
});
