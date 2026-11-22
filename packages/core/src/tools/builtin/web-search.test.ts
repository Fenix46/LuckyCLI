import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveWebSearchConfig, searchWeb, webSearchTool } from "./web-search.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () => jsonResponse(body, status)) as unknown as typeof fetch;
}

describe("resolveWebSearchConfig", () => {
  it("prefers the explicit provider and falls back to the first configured one", () => {
    expect(resolveWebSearchConfig({ BRAVE_SEARCH_API_KEY: "b" })).toEqual({
      provider: "brave",
      apiKey: "b",
    });
    expect(resolveWebSearchConfig({ TAVILY_API_KEY: "t" })).toEqual({
      provider: "tavily",
      apiKey: "t",
    });
    expect(
      resolveWebSearchConfig({ LUCKY_WEB_SEARCH_URL: "https://search.example/api", LUCKY_WEB_SEARCH_API_KEY: "k" }),
    ).toEqual({ provider: "custom", endpoint: "https://search.example/api", apiKey: "k" });
    expect(
      resolveWebSearchConfig({ LUCKY_WEB_SEARCH_PROVIDER: "tavily", BRAVE_SEARCH_API_KEY: "b", TAVILY_API_KEY: "t" }),
    ).toEqual({ provider: "tavily", apiKey: "t" });
    expect(resolveWebSearchConfig({})).toBeUndefined();
  });
});

describe("searchWeb", () => {
  it("normalizes Brave results and sends the subscription token", async () => {
    const spy = vi.fn(async () =>
      jsonResponse({
        web: {
          results: [
            { title: "First", url: "https://first.example/a", description: "  one   two  " },
            { title: "Bad", url: "javascript:alert(1)", description: "nope" },
          ],
        },
      }),
    );
    const results = await searchWeb(
      "query",
      { provider: "brave", apiKey: "secret" },
      { count: 3 },
      spy as unknown as typeof fetch,
    );
    expect(results).toEqual([
      { title: "First", url: "https://first.example/a", snippet: "one two" },
    ]);
    expect(spy).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Subscription-Token": "secret" }),
      }),
    );
  });

  it("sends the Tavily body and normalizes content", async () => {
    const spy = vi.fn(async () =>
      jsonResponse({ results: [{ title: "T", url: "https://t.example", content: "text" }] }),
    );
    const results = await searchWeb(
      "q",
      { provider: "tavily", apiKey: "tv" },
      { count: 2, allowedDomains: ["t.example"] },
      spy as unknown as typeof fetch,
    );
    expect(results).toEqual([{ title: "T", url: "https://t.example", snippet: "text" }]);
    const init = (spy.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toMatchObject({
      api_key: "tv",
      query: "q",
      max_results: 2,
      include_domains: ["t.example"],
    });
  });

  it("filters allowed and blocked domains, including subdomains", async () => {
    const spy = vi.fn(async () =>
      jsonResponse({
        results: [
          { title: "good", url: "https://good.com/a", content: "1" },
          { title: "sub", url: "https://sub.good.com/b", content: "2" },
          { title: "bad", url: "https://bad.com/c", content: "3" },
        ],
      }),
    );
    const results = await searchWeb(
      "q",
      { provider: "custom", endpoint: "https://search.example/api" },
      { allowedDomains: ["good.com"], blockedDomains: ["sub.good.com"] },
      spy as unknown as typeof fetch,
    );
    expect(results.map((r) => r.url)).toEqual(["https://good.com/a"]);
  });

  it("reports an HTTP failure", async () => {
    const spy = vi.fn(async () => new Response("boom", { status: 503 }));
    await expect(
      searchWeb("q", { provider: "brave", apiKey: "k" }, {}, spy as unknown as typeof fetch),
    ).rejects.toThrow(/HTTP 503/);
  });
});

describe("web_search tool", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns a formatted result list", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          web: { results: [{ title: "Result", url: "https://r.example", description: "snippet" }] },
        }),
      ),
    );
    const result = await webSearchTool.execute({ query: "hello" }, { cwd: "/" });
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("1. Result");
    expect(result.content).toContain("https://r.example");
    expect(result.content).toContain("snippet");
  });

  it("explains how to configure a missing provider", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");
    vi.stubEnv("TAVILY_API_KEY", "");
    vi.stubEnv("LUCKY_WEB_SEARCH_URL", "");
    const result = await webSearchTool.execute({ query: "hello" }, { cwd: "/" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("BRAVE_SEARCH_API_KEY");
    expect(result.content).toContain("LUCKY_WEB_SEARCH_URL");
  });
});
