import { describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../types.js";
import { toolSearchTool } from "./tool-search.js";

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    cwd: "/repo",
    ...overrides,
  };
}

describe("tool_search", () => {
  it("returns the matched schema and activates the tools", async () => {
    const activateTools = vi.fn(() => ["mcp_jira_search"]);
    const ctx = context({
      toolSearch: () => [
        {
          name: "mcp_jira_search",
          description: "Search Jira issues.",
          parameters: { type: "object", properties: { query: { type: "string" } } },
        },
      ],
      activateTools,
    });

    const result = await toolSearchTool.execute({ query: "jira" }, ctx);
    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("mcp_jira_search");
    expect(result.content).toContain("Search Jira issues.");
    expect(result.content).toContain("\"query\"");
    expect(result.content).toContain("Activated: mcp_jira_search");
    expect(activateTools).toHaveBeenCalledWith(["mcp_jira_search"]);
  });

  it("explains when nothing matches", async () => {
    const ctx = context({
      toolSearch: () => [],
      activateTools: () => [],
    });
    const result = await toolSearchTool.execute({ query: "nope" }, ctx);
    expect(result.content).toContain("No deferred tools match");
  });

  it("fails clearly without a registry bridge", async () => {
    const result = await toolSearchTool.execute({ query: "jira" }, context());
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/not available/i);
  });

  it("caps a huge schema and says the full one arrives next", async () => {
    const ctx = context({
      toolSearch: () => [
        {
          name: "mcp_big",
          description: "A tool with a huge schema.",
          parameters: { type: "object", description: "x".repeat(10_000) },
        },
      ],
      activateTools: () => ["mcp_big"],
    });
    const result = await toolSearchTool.execute({ query: "big" }, ctx);
    expect(result.content).toContain("schema truncated");
    expect(result.content.length).toBeLessThan(8_000);
  });
});
