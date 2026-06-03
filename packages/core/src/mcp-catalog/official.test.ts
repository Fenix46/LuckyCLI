import { describe, expect, it, vi } from "vitest";
import { OfficialMcpRegistryCatalog } from "./official.js";

describe("OfficialMcpRegistryCatalog", () => {
  it("searches and ranks matching servers from registry pages", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          servers: [
            { name: "io.github.example/docs-search", title: "Docs Search", description: "Search docs" },
            { name: "io.github.example/github-tools", title: "GitHub Tools", description: "Manage pull requests" },
          ],
          metadata: {},
        }),
        { status: 200 },
      ),
    );

    const catalog = new OfficialMcpRegistryCatalog({ fetchFn });
    const result = await catalog.search("docs");

    expect(result.items.map((item) => item.name)).toEqual(["io.github.example/docs-search"]);
  });

  it("loads the latest version detail for one server", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          name: "io.github.example/docs-search",
          title: "Docs Search",
          remotes: [{ type: "streamable-http", url: "https://example.com/mcp" }],
        }),
        { status: 200 },
      ),
    );

    const catalog = new OfficialMcpRegistryCatalog({ fetchFn });
    const detail = await catalog.get("io.github.example/docs-search");

    expect(detail).toEqual({
      name: "io.github.example/docs-search",
      title: "Docs Search",
      remotes: [{ type: "streamable-http", url: "https://example.com/mcp" }],
    });
  });
});
