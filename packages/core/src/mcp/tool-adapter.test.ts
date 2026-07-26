import { describe, expect, it, vi } from "vitest";
import { ToolRegistry } from "../tools/registry.js";
import { adaptMcpTool, makeMcpToolName, uniqueMcpToolName } from "./tool-adapter.js";

describe("mcp tool adapter", () => {
  it("sanitizes server and tool names into a Lucky tool name", () => {
    expect(makeMcpToolName("docs/api", "search.query")).toBe("docs_api_search_query");
  });

  it("sanitization alone is not injective across server/tool pairs", () => {
    // The reason uniqueMcpToolName exists: two different pairs, one name.
    expect(makeMcpToolName("docs/api", "search")).toBe(makeMcpToolName("docs", "api_search"));
  });

  it("gives the first claimant the natural name and suffixes colliders", () => {
    const taken = new Set<string>();
    expect(uniqueMcpToolName("docs/api", "search", taken)).toBe("docs_api_search");
    expect(uniqueMcpToolName("docs", "api_search", taken)).toBe("docs_api_search_2");
    expect(uniqueMcpToolName("docs", "api/search", taken)).toBe("docs_api_search_3");
  });

  it("disambiguated names all register without dropping a tool", () => {
    const taken = new Set<string>();
    const pairs: [string, string][] = [
      ["docs/api", "search"],
      ["docs", "api_search"],
    ];
    const registry = new ToolRegistry();
    for (const [server, tool] of pairs) {
      registry.register(
        adaptMcpTool(
          server,
          { name: tool },
          async () => ({ content: "ok" }),
          uniqueMcpToolName(server, tool, taken),
        ),
      );
    }
    expect(registry.definitions().map((d) => d.name)).toEqual([
      "docs_api_search",
      "docs_api_search_2",
    ]);
  });

  it("keeps invoking the server's original tool name after renaming", async () => {
    const invoke = vi.fn(async () => ({ content: "ok" }));
    const tool = adaptMcpTool(
      "docs",
      { name: "api/search" },
      invoke,
      "docs_api_search_2",
    );

    await new ToolRegistry().register(tool).execute("docs_api_search_2", {}, { cwd: "/" });

    // The registry name is a local alias; the wire call must use the real name.
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ server: "docs", tool: "api/search" }),
      expect.anything(),
    );
  });

  it("preserves the MCP JSON schema in provider-facing definitions", () => {
    const tool = adaptMcpTool(
      "docs/api",
      {
        name: "search.query",
        description: "Search docs.",
        inputSchema: {
          type: "object",
          properties: {
            q: { type: "string" },
          },
          required: ["q"],
          additionalProperties: false,
        },
      },
      async () => ({ content: "ok" }),
    );

    const defs = new ToolRegistry().register(tool).definitions();
    expect(defs[0]).toMatchObject({
      name: "docs_api_search_query",
      description: "Search docs.",
      parameters: {
        type: "object",
        properties: {
          q: { type: "string" },
        },
        required: ["q"],
        additionalProperties: false,
      },
    });
  });

  it("delegates execution to the provided invoker", async () => {
    const invoke = vi.fn(async () => ({ content: "done" }));
    const tool = adaptMcpTool(
      "github",
      {
        name: "search",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
        },
      },
      invoke,
    );

    const ctx = { cwd: "/" };
    const result = await tool.execute({ query: "repo:openai" }, ctx);

    expect(result).toEqual({ content: "done" });
    expect(invoke).toHaveBeenCalledWith(
      {
        server: "github",
        tool: "search",
        arguments: { query: "repo:openai" },
      },
      ctx,
    );
  });

  it("forwards the tool context to the invoker", async () => {
    const onFilesChanged = vi.fn();
    const invoke = vi.fn(async () => ({ content: "ok" }));
    const tool = adaptMcpTool(
      "fs",
      { name: "write", inputSchema: { type: "object" } },
      invoke,
    );

    const ctx = { cwd: "/repo", onFilesChanged };
    await tool.execute({}, ctx);

    expect(invoke).toHaveBeenCalledWith(expect.anything(), ctx);
  });
});
