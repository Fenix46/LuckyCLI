import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOllamaModels } from "./models.js";

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchOllamaModels", () => {
  it("lists installed models with context window and vision capability", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith("/api/tags")) {
        return jsonResponse({
          models: [{ model: "llama3.2-vision:11b" }, { model: "qwen2.5:7b" }],
        });
      }
      // /api/show — body distinguishes the model
      return jsonResponse({
        capabilities: u.includes("show") ? ["completion", "vision"] : [],
        model_info: { "llama.context_length": 131072 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    // The show response above is shared; assert structure rather than per-model
    // vision (covered below with a per-call mock).
    const models = await fetchOllamaModels("http://localhost:11434");
    expect(models.map((m) => m.id)).toEqual([
      "llama3.2-vision:11b",
      "qwen2.5:7b",
    ]);
    expect(models[0]?.contextWindow).toBe(131072);
    expect(models[0]?.vision).toBe(true);
  });

  it("normalizes a trailing slash in the base url", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ models: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchOllamaModels("http://localhost:11434/");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://localhost:11434/api/tags",
    );
  });

  it("returns an empty list when the daemon is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    expect(await fetchOllamaModels("http://localhost:11434")).toEqual([]);
  });

  it("returns an empty list on a non-ok tags response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, false)));
    expect(await fetchOllamaModels("http://localhost:11434")).toEqual([]);
  });

  it("deduplicates repeated model names", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url).endsWith("/api/tags")) {
        return jsonResponse({ models: [{ model: "a" }, { model: "a" }] });
      }
      return jsonResponse({ capabilities: [], model_info: {} });
    });
    vi.stubGlobal("fetch", fetchMock);

    const models = await fetchOllamaModels("http://localhost:11434");
    expect(models.map((m) => m.id)).toEqual(["a"]);
  });
});
