import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool, ToolRegistry } from "@luckycli/core";
import { createRuntimeToolRegistry, registerExtraTools } from "./runtime.js";

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

describe("buildAgent cache hints", () => {
  it("reuses a resumed session's system prompt and cache key verbatim", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { buildAgent } = await import("./runtime.js");
    const cwd = await mkdtemp(join(tmpdir(), "lucky-runtime-"));
    const saved = process.env.LUCKY_SYSTEM;
    delete process.env.LUCKY_SYSTEM;
    try {
      const base = {
        provider: "openai" as const,
        model: "gpt-4o",
        credentials: { type: "openai" as const, apiKey: "test" },
        system: "default system",
        composeSystemFromContext: true,
        cwd,
      };
      const resumed = buildAgent({ ...base, cacheHints: { systemPrompt: "STORED PROMPT", promptCacheKey: "conv-1" } });
      expect(resumed.systemPrompt).toBe("STORED PROMPT");
      expect(resumed.cacheKey).toBe("conv-1");

      const fresh = buildAgent(base);
      expect(fresh.systemPrompt).not.toBe("STORED PROMPT");
      expect(fresh.cacheKey).not.toBe("conv-1");
    } finally {
      if (saved !== undefined) process.env.LUCKY_SYSTEM = saved;
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
