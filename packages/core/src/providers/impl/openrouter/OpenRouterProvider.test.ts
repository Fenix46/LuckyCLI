import OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OPENROUTER_BASE_URL,
  OpenRouterProvider,
} from "./OpenRouterProvider.js";

vi.mock("openai", () => {
  const OpenAI = vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn() } },
    models: { list: vi.fn() },
  }));
  return { default: OpenAI };
});

// The constructor preloads /models; default to a hermetic empty list.
function stubModels(
  data: Array<{
    id: string;
    context_length?: number;
    top_provider?: { context_length?: number };
  }> = [],
) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data }) }),
  );
}

describe("OpenRouterProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubModels();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("targets the OpenRouter endpoint with attribution headers", () => {
    const provider = new OpenRouterProvider({
      type: "openrouter",
      apiKey: "sk-or-test",
    });

    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: "sk-or-test",
      baseURL: OPENROUTER_BASE_URL,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/luckycli",
        "X-Title": "lucky",
      },
    });
    expect(provider.info.id).toBe("openrouter");
  });

  it("preloads per-model context windows from /models", async () => {
    stubModels([
      {
        id: "anthropic/claude-sonnet-4-6",
        context_length: 200000,
        top_provider: { context_length: 180000 },
      },
      { id: "x/no-ctx" },
    ]);

    const provider = new OpenRouterProvider({
      type: "openrouter",
      apiKey: "sk-or-test",
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(
      provider.info.models?.["anthropic/claude-sonnet-4-6"]?.contextWindow,
    ).toBe(180000);
    expect(provider.info.models?.["x/no-ctx"]).toBeUndefined();
  });
});
