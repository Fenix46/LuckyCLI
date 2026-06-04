import { describe, expect, it, vi } from "vitest";
import { ToolRegistry } from "../tools/registry.js";
import { adaptMcpTool, makeMcpToolName } from "./tool-adapter.js";

describe("mcp tool adapter", () => {
  it("sanitizes server and tool names into a Lucky tool name", () => {
    expect(makeMcpToolName("docs/api", "search.query")).toBe("docs_api_search_query");
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
