import { describe, expect, it, vi } from "vitest";
import type { StoredConfig } from "@luckycli/core";
import {
  ACP_COMMANDS,
  availableCommands,
  parseCommand,
  unknownCommandHelp,
  type CommandContext,
} from "./commands.js";

/** A command context whose every side effect is observable and offline. */
function context(overrides: Partial<CommandContext> = {}): CommandContext & {
  saved: () => StoredConfig | undefined;
  rebuilds: () => number;
} {
  let config: StoredConfig = {};
  let saved: StoredConfig | undefined;
  let rebuilds = 0;
  const ctx = {
    agent: {
      async contextStatus() {
        return {
          model: "mock",
          usedTokens: 1_000,
          usableTokens: 10_000,
          usedPercentage: 10,
          tokenCounter: "usage" as const,
        };
      },
      async compactNow() {
        return { removedMessages: 4, keptMessages: 2, beforeTokens: 900, afterTokens: 300 };
      },
      messages: [],
    },
    cwd: "/repo",
    provider: "claude",
    model: "claude-sonnet-5",
    buildGraph: async () => ({
      fileCount: 3,
      nodeCount: 12,
      edgeCount: 20,
      droppedEdges: 0,
      path: "/repo/.luckycli/graph.json",
    }),
    recordGraphBuilt: () => {},
    store: {
      load: () => config,
      save: (next: StoredConfig) => {
        config = next;
        saved = next;
      },
    },
    rebuild: async () => {
      rebuilds += 1;
    },
    ...overrides,
  } as unknown as CommandContext;
  return Object.assign(ctx, { saved: () => saved, rebuilds: () => rebuilds });
}

function run(name: string, args = "", ctx = context()): Promise<string> {
  const command = ACP_COMMANDS.find((c) => c.name === name);
  if (!command) throw new Error(`no such command: ${name}`);
  return command.run(args, ctx);
}

describe("availableCommands", () => {
  it("advertises the roster with hints where arguments are accepted", () => {
    const roster = availableCommands();
    expect(roster.map((c) => c.name)).toEqual([
      "graph",
      "status",
      "context",
      "compact",
      "thinking",
    ]);
    expect(roster.find((c) => c.name === "graph")?.input).toEqual({ hint: "build|rebuild" });
    // A command taking no arguments advertises no input hint.
    expect(roster.find((c) => c.name === "status")?.input).toBeUndefined();
  });

  it("gives every command a description for the editor's menu", () => {
    for (const command of availableCommands()) {
      expect(command.description.length).toBeGreaterThan(0);
    }
  });
});

describe("parseCommand", () => {
  it("recognizes a bare command", () => {
    expect(parseCommand("/status")).toMatchObject({ name: "status", args: "" });
  });

  it("splits arguments off the command name", () => {
    expect(parseCommand("/graph rebuild")).toMatchObject({ name: "graph", args: "rebuild" });
    expect(parseCommand("/thinking on")).toMatchObject({ name: "thinking", args: "on" });
  });

  it("tolerates leading whitespace and mixed case", () => {
    expect(parseCommand("  /STATUS")).toMatchObject({ name: "status" });
  });

  it("resolves the command when we advertise it, and flags it when we don't", () => {
    expect(parseCommand("/status")?.command).toBeDefined();
    expect(parseCommand("/nope")?.command).toBeUndefined();
    expect(parseCommand("/nope")?.name).toBe("nope");
  });

  it("leaves ordinary prompts alone", () => {
    expect(parseCommand("please fix the bug")).toBeUndefined();
    // A slash that isn't at the start is just text.
    expect(parseCommand("run a/b then c")).toBeUndefined();
    // A path-looking prompt is not a command name.
    expect(parseCommand("/usr/local/bin matters here")).toMatchObject({ name: "usr" });
    // A lone slash names nothing.
    expect(parseCommand("/")).toBeUndefined();
    expect(parseCommand("")).toBeUndefined();
  });

  it("keeps trailing lines as arguments so multi-line input is not lost", () => {
    expect(parseCommand("/graph build\nextra context")).toMatchObject({
      name: "graph",
      args: "build\nextra context",
    });
  });
});

describe("unknownCommandHelp", () => {
  it("names the miss and lists what is available", () => {
    const help = unknownCommandHelp("bogus");
    expect(help).toContain("/bogus");
    for (const command of ACP_COMMANDS) expect(help).toContain(`/${command.name}`);
  });
});

describe("/graph", () => {
  it("builds the graph in the session cwd and reports the summary", async () => {
    const buildGraph = vi.fn(async () => ({
      fileCount: 3,
      nodeCount: 12,
      edgeCount: 20,
      droppedEdges: 2,
      path: "/repo/.luckycli/graph.json",
    }));
    const recordGraphBuilt = vi.fn();
    const ctx = context({
      buildGraph: buildGraph as unknown as CommandContext["buildGraph"],
      recordGraphBuilt,
    });

    const out = await run("graph", "", ctx);

    expect(buildGraph).toHaveBeenCalledWith("/repo");
    expect(recordGraphBuilt).toHaveBeenCalledWith("/repo");
    expect(out).toContain("files: 3");
    expect(out).toContain("nodes: 12");
    expect(out).toContain("edges: 20");
    expect(out).toContain("dropped: 2 unresolved edges");
  });

  it("omits the dropped-edges line when there are none", async () => {
    expect(await run("graph")).not.toContain("dropped");
  });

  it("rejects an unknown argument instead of building", async () => {
    const buildGraph = vi.fn();
    const ctx = context({ buildGraph: buildGraph as unknown as CommandContext["buildGraph"] });
    expect(await run("graph", "sideways", ctx)).toContain("Usage:");
    expect(buildGraph).not.toHaveBeenCalled();
  });

  it("reports a build failure as text rather than throwing", async () => {
    const ctx = context({
      buildGraph: (async () => {
        throw new Error("no such directory");
      }) as unknown as CommandContext["buildGraph"],
    });
    expect(await run("graph", "", ctx)).toContain("no such directory");
  });
});

describe("/status and /context", () => {
  it("reports provider, model, cwd and context usage", async () => {
    const out = await run("status");
    expect(out).toContain("claude");
    expect(out).toContain("claude-sonnet-5");
    expect(out).toContain("/repo");
    expect(out).toContain("1000 / 10000 tokens (10%)");
  });

  it("/context reports the same figures", async () => {
    expect(await run("context")).toContain("1000 / 10000 tokens (10%)");
  });

  it("survives a provider that cannot report context", async () => {
    const ctx = context({
      agent: {
        async contextStatus() {
          throw new Error("provider down");
        },
      } as unknown as CommandContext["agent"],
    });
    // /status still answers with what it does know.
    expect(await run("status", "", ctx)).toContain("claude-sonnet-5");
    expect(await run("context", "", ctx)).toContain("not available");
  });
});

describe("/compact", () => {
  it("compacts and reports what it removed", async () => {
    const out = await run("compact");
    expect(out).toContain("removed: 4 messages");
    expect(out).toContain("kept: 2 messages");
    expect(out).toContain("900 → 300");
  });

  it("rejects arguments", async () => {
    expect(await run("compact", "now")).toContain("Usage:");
  });

  it("reports a compaction failure as text", async () => {
    const ctx = context({
      agent: {
        async compactNow() {
          throw new Error("summarizer unavailable");
        },
      } as unknown as CommandContext["agent"],
    });
    expect(await run("compact", "", ctx)).toContain("summarizer unavailable");
  });
});

describe("/thinking", () => {
  it("reports the current setting with no argument", async () => {
    // Claude's adaptive thinking is on unless the user turned it off.
    expect(await run("thinking")).toContain("enabled");
  });

  it("persists the toggle per provider and rebuilds the runtime", async () => {
    const ctx = context();
    const out = await run("thinking", "off", ctx);

    expect(out).toContain("disabled");
    expect(ctx.saved()?.providerSettings?.claude?.thinkingEnabled).toBe(false);
    // The rebuild is what makes the setting apply to the next turn.
    expect(ctx.rebuilds()).toBe(1);
    // And the new value is what a subsequent read reports.
    expect(await run("thinking", "", ctx)).toContain("disabled");
  });

  it("preserves the rest of the stored config when toggling", async () => {
    const ctx = context();
    await run("thinking", "on", ctx);
    // A second toggle must not lose the first provider's other settings.
    expect(ctx.saved()?.providerSettings?.claude).toMatchObject({ thinkingEnabled: true });
  });

  it("rejects a bad argument without saving or rebuilding", async () => {
    const ctx = context();
    expect(await run("thinking", "maybe", ctx)).toContain("Usage:");
    expect(ctx.saved()).toBeUndefined();
    expect(ctx.rebuilds()).toBe(0);
  });

  it("refuses on a provider that has no thinking toggle", async () => {
    const ctx = context({ provider: "openai" as CommandContext["provider"] });
    expect(await run("thinking", "on", ctx)).toContain("only supported for Claude");
    expect(ctx.saved()).toBeUndefined();
  });
});
