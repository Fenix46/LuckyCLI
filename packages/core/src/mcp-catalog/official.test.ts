import { describe, expect, it, vi } from "vitest";
import { OfficialMcpRegistryCatalog } from "./official.js";

describe("OfficialMcpRegistryCatalog", () => {
  it("uses the registry search parameter for matching servers", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          servers: [
            {
              server: {
                name: "io.github.example/docs-search",
                description: "Search docs",
                version: "1.0.0",
              },
              _meta: {
                "io.modelcontextprotocol.registry/official": {
                  status: "active",
                },
              },
            },
            {
              server: {
                name: "io.github.example/github-tools",
                description: "Manage pull requests",
                version: "1.1.0",
              },
              _meta: {
                "io.modelcontextprotocol.registry/official": {
                  status: "active",
                },
              },
            },
          ],
          metadata: {},
        }),
        { status: 200 },
      ),
    );

    const catalog = new OfficialMcpRegistryCatalog({ fetchFn });
    const result = await catalog.search("docs");

    expect(result.items.map((item) => item.name)).toContain("io.github.example/docs-search");
    expect(fetchFn).toHaveBeenCalledWith(
      expect.stringContaining("/v0.1/servers?limit=100&search=docs"),
    );
  });

  it("lists the first page when the query is empty", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          servers: [
            { server: { name: "a/server", description: "A" } },
            { server: { name: "b/server", description: "B" } },
          ],
          metadata: {},
        }),
        { status: 200 },
      ),
    );

    const catalog = new OfficialMcpRegistryCatalog({ fetchFn });
    const result = await catalog.search("");

    expect(result.items.map((item) => item.name)).toEqual(["a/server", "b/server"]);
  });

  it("loads the latest version detail for one server", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          server: {
            name: "io.github.example/docs-search",
            description: "Docs Search",
            remotes: [{ type: "streamable-http", url: "https://example.com/mcp" }],
          },
          _meta: {
            "io.modelcontextprotocol.registry/official": {
              status: "active",
            },
          },
        }),
        { status: 200 },
      ),
    );

    const catalog = new OfficialMcpRegistryCatalog({ fetchFn });
    const detail = await catalog.get("io.github.example/docs-search");

    expect(detail).toEqual({
      name: "io.github.example/docs-search",
      description: "Docs Search",
      remotes: [{ type: "streamable-http", url: "https://example.com/mcp" }],
      status: "active",
    });
  });
});
