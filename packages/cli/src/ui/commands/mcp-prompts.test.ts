import { describe, expect, it, vi } from "vitest";
import type { McpPromptDescriptor } from "@luckycli/core";
import { buildMcpPromptCommands, mcpPromptSlashName, parseMcpPromptArgs } from "./mcp-prompts.js";
import type { CommandContext } from "./types.js";
import type { Item } from "../lib/items.js";

const prompt: McpPromptDescriptor = {
  name: "review-code",
  description: "Review a change",
  arguments: [{ name: "topic" }, { name: "depth" }],
};

function harness(ok = true): {
  ctx: CommandContext;
  emitted: Item[];
  calls: Array<{ server: string; prompt: string; args: Record<string, string> }>;
} {
  const emitted: Item[] = [];
  const calls: Array<{ server: string; prompt: string; args: Record<string, string> }> = [];
  const ctx = {
    emit: (...items: Item[]) => emitted.push(...items),
    ui: {
      runMcpPrompt: vi.fn(async (server: string, name: string, args: Record<string, string>) => {
        calls.push({ server, prompt: name, args });
        return ok;
      }),
    },
  } as unknown as CommandContext;
  return { ctx, emitted, calls };
}

describe("mcpPromptSlashName", () => {
  it("uses the mcp__server__prompt convention and sanitizes tokens", () => {
    expect(mcpPromptSlashName("my-server", "review-code")).toBe("/mcp__my-server__review-code");
    expect(mcpPromptSlashName("my.server", "review code")).toBe("/mcp__my_server__review_code");
  });
});

describe("parseMcpPromptArgs", () => {
  it("fills declared arguments positionally", () => {
    expect(parseMcpPromptArgs("security deep", prompt.arguments)).toEqual({
      topic: "security",
      depth: "deep",
    });
  });

  it("accepts name=value for declared arguments", () => {
    expect(parseMcpPromptArgs("topic=auth deep", prompt.arguments)).toEqual({
      topic: "auth",
      depth: "deep",
    });
  });

  it("honors quoted values", () => {
    expect(parseMcpPromptArgs(`topic="auth flow" shallow`, prompt.arguments)).toEqual({
      topic: "auth flow",
      depth: "shallow",
    });
  });

  it("treats an unknown name=value token positionally", () => {
    expect(parseMcpPromptArgs("other=x y", prompt.arguments)).toEqual({
      topic: "other=x",
      depth: "y",
    });
  });
});

describe("buildMcpPromptCommands", () => {
  it("builds a visible slash command per prompt", () => {
    const [command] = buildMcpPromptCommands([{ server: "rea", prompt }]);
    expect(command?.name).toBe("/mcp__rea__review-code");
    expect(command?.description).toBe("Review a change");
    expect(command?.hidden).toBeFalsy();
  });

  it("runs the prompt with parsed arguments", async () => {
    const [command] = buildMcpPromptCommands([{ server: "rea", prompt }]);
    const { ctx, emitted, calls } = harness();
    await command!.run("security deep", ctx);
    expect(calls).toEqual([{ server: "rea", prompt: "review-code", args: { topic: "security", depth: "deep" } }]);
    expect(emitted[0]).toMatchObject({ kind: "command", title: "MCP prompt" });
  });

  it("reports a failed prompt", async () => {
    const [command] = buildMcpPromptCommands([{ server: "rea", prompt }]);
    const { ctx, emitted } = harness(false);
    await command!.run("", ctx);
    expect(emitted.at(-1)).toMatchObject({ kind: "error" });
  });
});
