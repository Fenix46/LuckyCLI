import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool } from "@luckycli/core";
import { createRuntimeToolRegistry } from "./runtime.js";

describe("createRuntimeToolRegistry", () => {
  it("composes built-in tools with extra runtime tools", () => {
    const extra = defineTool({
      name: "mcp_echo",
      description: "Echo from MCP runtime.",
      schema: z.object({ message: z.string() }),
      async execute({ message }) {
        return { content: message };
      },
    });

    const registry = createRuntimeToolRegistry([extra]);

    expect(registry.has("read_file")).toBe(true);
    expect(registry.has("mcp_echo")).toBe(true);
  });
});
