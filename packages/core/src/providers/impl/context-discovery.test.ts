import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLlamaCppContextWindow } from "./llamacpp/context.js";
import {
  fetchVllmContextWindow,
  fetchVllmContextWindows,
} from "./vllm/context.js";

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

afterEach(() => vi.restoreAllMocks());

describe("fetchLlamaCppContextWindow", () => {
  it("reads n_ctx from default_generation_settings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ default_generation_settings: { n_ctx: 8192 } }),
      ),
    );
    expect(await fetchLlamaCppContextWindow("http://localhost:8080")).toBe(8192);
  });

  it("falls back to a top-level n_ctx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ n_ctx: 4096 })));
    expect(await fetchLlamaCppContextWindow("http://localhost:8080/")).toBe(4096);
  });

  it("hits the /props endpoint", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ n_ctx: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchLlamaCppContextWindow("http://localhost:8080");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://localhost:8080/props");
  });

  it("returns undefined when unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect(await fetchLlamaCppContextWindow("http://localhost:8080")).toBeUndefined();
  });
});

describe("fetchVllmContextWindows", () => {
  it("maps each model id to its max_model_len", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          data: [
            { id: "Qwen3-32B", max_model_len: 81920 },
            { id: "llama-3", max_model_len: 8192 },
            { id: "no-len" },
          ],
        }),
      ),
    );
    expect(await fetchVllmContextWindows("http://localhost:8000")).toEqual({
      "Qwen3-32B": 81920,
      "llama-3": 8192,
    });
  });

  it("forwards a bearer token when an api key is given", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchVllmContextWindows("http://localhost:8000", "secret");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret");
  });

  it("fetchVllmContextWindow returns the largest window", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ data: [{ id: "a", max_model_len: 4096 }, { id: "b", max_model_len: 32768 }] }),
      ),
    );
    expect(await fetchVllmContextWindow("http://localhost:8000")).toBe(32768);
  });

  it("returns {} / undefined when unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, false)));
    expect(await fetchVllmContextWindows("http://localhost:8000")).toEqual({});
    expect(await fetchVllmContextWindow("http://localhost:8000")).toBeUndefined();
  });
});
