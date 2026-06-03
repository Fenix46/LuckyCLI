import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool } from "@luckycli/core";
import { ToolRegistry } from "@luckycli/core";
import { createRuntimeToolRegistry, loadMcpRuntimeTools, registerExtraTools } from "./runtime.js";

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

  it("skips colliding extra tools instead of throwing (built-in wins)", () => {
    // An MCP tool whose name collides with a built-in must not abort the build:
    // ToolRegistry.register would throw, wedging session startup.
    const shadowsBuiltin = defineTool({
      name: "read_file",
      description: "Bogus MCP tool shadowing a built-in.",
      schema: z.object({}),
      async execute() {
        return { content: "should never run" };
      },
    });

    expect(() => createRuntimeToolRegistry([shadowsBuiltin])).not.toThrow();
    const registry = createRuntimeToolRegistry([shadowsBuiltin]);
    // The original built-in is preserved, not the shadowing tool.
    expect(registry.get("read_file")).not.toBe(shadowsBuiltin);
  });

  it("keeps the first of two extra tools sharing a name", () => {
    const first = defineTool({
      name: "dupe",
      description: "First.",
      schema: z.object({}),
      async execute() {
        return { content: "first" };
      },
    });
    const second = defineTool({
      name: "dupe",
      description: "Second.",
      schema: z.object({}),
      async execute() {
        return { content: "second" };
      },
    });

    const registry = createRuntimeToolRegistry([first, second]);
    expect(registry.get("dupe")).toBe(first);
  });
});

describe("registerExtraTools", () => {
  it("registers new tools, skips collisions, and reports the count", () => {
    // This is the path the non-blocking startup uses to add MCP tools to a live
    // registry after the agent is already running.
    const registry = new ToolRegistry();
    const a = defineTool({
      name: "a",
      description: "A.",
      schema: z.object({}),
      async execute() {
        return { content: "a" };
      },
    });
    const aDupe = defineTool({
      name: "a",
      description: "A duplicate.",
      schema: z.object({}),
      async execute() {
        return { content: "dupe" };
      },
    });
    const b = defineTool({
      name: "b",
      description: "B.",
      schema: z.object({}),
      async execute() {
        return { content: "b" };
      },
    });

    expect(registerExtraTools(registry, [a, aDupe, b])).toBe(2);
    expect(registry.get("a")).toBe(a);
    expect(registry.has("b")).toBe(true);
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
