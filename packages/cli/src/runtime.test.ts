import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool } from "@luckycli/core";
import { createRuntimeToolRegistry, loadMcpRuntimeTools } from "./runtime.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureServer = resolve(here, "../../core/src/mcp/__fixtures__/stdio-server.mjs");

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

describe("loadMcpRuntimeTools", () => {
  it("loads MCP tools from configured local servers", async () => {
    const runtime = await loadMcpRuntimeTools(
      {
        docs: {
          type: "local",
          command: ["node", fixtureServer],
          timeout: 5_000,
        },
      },
      process.cwd(),
    );

    try {
      expect(runtime.extraTools.map((tool) => tool.name)).toContain("docs_echo");
    } finally {
      await runtime.mcpManager?.close();
    }
  });
});
