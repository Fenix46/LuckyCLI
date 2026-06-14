import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOpenAiCompatibleModels } from "./openai-models.js";

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

afterEach(() => vi.restoreAllMocks());

describe("fetchOpenAiCompatibleModels", () => {
  it("lists model ids and carries max_model_len when present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          data: [
            { id: "Qwen3-32B", max_model_len: 81920 },
            { id: "llama-3" },
          ],
        }),
      ),
    );
    expect(await fetchOpenAiCompatibleModels("http://localhost:8000")).toEqual([
      { id: "Qwen3-32B", contextWindow: 81920 },
      { id: "llama-3" },
    ]);
  });

  it("appends /v1/models to a bare origin", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchOpenAiCompatibleModels("http://localhost:8080");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://localhost:8080/v1/models");
  });

  it("respects a base url that already has a path", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchOpenAiCompatibleModels("https://gw.example.com/openai/v1");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://gw.example.com/openai/v1/models",
    );
  });

  it("forwards a bearer token", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchOpenAiCompatibleModels("http://localhost:8000", "secret");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret");
  });

  it("deduplicates and returns [] when unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ data: [{ id: "a" }, { id: "a" }] })),
    );
    expect(await fetchOpenAiCompatibleModels("http://x")).toEqual([{ id: "a" }]);

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect(await fetchOpenAiCompatibleModels("http://x")).toEqual([]);
  });
});
