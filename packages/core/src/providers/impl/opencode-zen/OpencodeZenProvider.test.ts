import OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("openai", () => {
  const OpenAI = vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn() } },
    models: { list: vi.fn() },
  }));
  return { default: OpenAI };
});

// Default: a hermetic empty models.dev response (the constructor preloads it).
function stubModelsDev(models: Record<string, { limit?: { context?: number } }> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ opencode: { models } }),
    }),
  );
}

describe("OpencodeZenProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    stubModelsDev();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uses the supplied API key against the zen endpoint", async () => {
    const { OPENCODE_ZEN_BASE_URL, OpencodeZenProvider } = await import(
      "./OpencodeZenProvider.js"
    );
    const provider = new OpencodeZenProvider({
      type: "opencode-zen",
      apiKey: "zen-key",
    });

    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: "zen-key",
      baseURL: OPENCODE_ZEN_BASE_URL,
      defaultHeaders: { "X-Title": "lucky" },
    });
    expect(provider.info.id).toBe("opencode-zen");
  });

  it("falls back to the public key when none is supplied", async () => {
    const { OPENCODE_ZEN_PUBLIC_KEY, OpencodeZenProvider } = await import(
      "./OpencodeZenProvider.js"
    );
    new OpencodeZenProvider({ type: "opencode-zen" });

    expect(OpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: OPENCODE_ZEN_PUBLIC_KEY }),
    );
  });

  it("preloads per-model context windows from models.dev", async () => {
    stubModelsDev({
      "deepseek-v4-flash-free": { limit: { context: 200000 } },
      "glm-4.7-free": { limit: { context: 204800 } },
    });
    const { OpencodeZenProvider } = await import("./OpencodeZenProvider.js");

    const provider = new OpencodeZenProvider({ type: "opencode-zen" });
    // Let the async preload settle.
    await new Promise((r) => setTimeout(r, 0));

    expect(provider.info.models?.["deepseek-v4-flash-free"]?.contextWindow).toBe(
      200000,
    );
    expect(provider.info.models?.["glm-4.7-free"]?.contextWindow).toBe(204800);
  });
});
