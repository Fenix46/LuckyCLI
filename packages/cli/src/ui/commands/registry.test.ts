import { describe, expect, it } from "vitest";
import { buildCommandRegistry, dispatchCommand, slashMenuEntries } from "./registry.js";
import type { Command, CommandContext } from "./types.js";
import type { Item } from "../lib/items.js";

function fakeContext(): { ctx: CommandContext; emitted: Item[] } {
  const emitted: Item[] = [];
  const ctx = {
    agent: {} as CommandContext["agent"],
    meta: { provider: "claude", model: "claude-sonnet-4-6" },
    emit: (...items: Item[]) => emitted.push(...items),
    setInput: () => {},
    ui: {},
  } as unknown as CommandContext;
  return { ctx, emitted };
}

function command(name: string, overrides: Partial<Command> = {}): Command & { calls: string[] } {
  const calls: string[] = [];
  return {
    name,
    description: `${name} test command`,
    run(args) {
      calls.push(args);
    },
    calls,
    ...overrides,
  };
}

describe("dispatchCommand", () => {
  it("ignores non-command text", async () => {
    const { ctx, emitted } = fakeContext();
    const help = command("/help");
    expect(await dispatchCommand("hello world", [help], ctx)).toBe(false);
    expect(help.calls).toEqual([]);
    expect(emitted).toEqual([]);
  });

  it("dispatches an exact name match with empty args", async () => {
    const { ctx } = fakeContext();
    const help = command("/help");
    expect(await dispatchCommand("/help", [help], ctx)).toBe(true);
    expect(help.calls).toEqual([""]);
  });

  it("dispatches name + args, passing trimmed args", async () => {
    const { ctx } = fakeContext();
    const model = command("/model");
    expect(await dispatchCommand("/model  gpt-5.5 ", [model], ctx)).toBe(true);
    expect(model.calls).toEqual(["gpt-5.5"]);
  });

  it("does not match a longer command name sharing the prefix", async () => {
    const { ctx, emitted } = fakeContext();
    const model = command("/model");
    expect(await dispatchCommand("/models", [model], ctx)).toBe(true);
    expect(model.calls).toEqual([]);
    expect(emitted).toEqual([
      { kind: "error", text: "unknown command: /models. Try /help." },
    ]);
  });

  it("dispatches aliases identically", async () => {
    const { ctx } = fakeContext();
    const exit = command("/exit", { aliases: ["/quit"] });
    expect(await dispatchCommand("/quit", [exit], ctx)).toBe(true);
    expect(exit.calls).toEqual([""]);
  });

  it("consumes unknown slash commands with the error item", async () => {
    const { ctx, emitted } = fakeContext();
    expect(await dispatchCommand("/nope", [], ctx)).toBe(true);
    expect(emitted).toEqual([
      { kind: "error", text: "unknown command: /nope. Try /help." },
    ]);
  });

  it("awaits async commands", async () => {
    const { ctx } = fakeContext();
    const order: string[] = [];
    const slow: Command = {
      name: "/slow",
      description: "async test command",
      async run() {
        await Promise.resolve();
        order.push("ran");
      },
    };
    await dispatchCommand("/slow", [slow], ctx);
    order.push("after");
    expect(order).toEqual(["ran", "after"]);
  });
});

describe("skill alias commands", () => {
  function ctxWithRunSkill(): { ctx: CommandContext; calls: string[]; emitted: Item[] } {
    const calls: string[] = [];
    const emitted: Item[] = [];
    const ctx = {
      emit: (...items: Item[]) => emitted.push(...items),
      ui: {
        runSkill: async (name: string) => {
          calls.push(name);
          return true;
        },
      },
    } as unknown as CommandContext;
    return { ctx, calls, emitted };
  }

  it("registers a hidden /<name> command per enabled skill", () => {
    const reg = buildCommandRegistry(["code-review", "release-flow"]);
    const cr = reg.find((c) => c.name === "/code-review");
    expect(cr).toBeDefined();
    expect(cr?.hidden).toBe(true);
    // hidden: stays out of the menu.
    expect(slashMenuEntries(reg).some((e) => e.name === "/code-review")).toBe(false);
  });

  it("dispatches /<name> to runSkill", async () => {
    const reg = buildCommandRegistry(["code-review"]);
    const { ctx, calls } = ctxWithRunSkill();
    expect(await dispatchCommand("/code-review", reg, ctx)).toBe(true);
    expect(calls).toEqual(["code-review"]);
  });

  it("never shadows a built-in command", () => {
    // A skill literally named "skill" must not replace the /skill command.
    const reg = buildCommandRegistry(["skill", "model"]);
    expect(reg.filter((c) => c.name === "/skill")).toHaveLength(1);
    expect(reg.find((c) => c.name === "/skill")?.hidden).toBeFalsy();
    expect(reg.filter((c) => c.name === "/model")).toHaveLength(1);
  });
});

describe("slashMenuEntries", () => {
  it("keeps the pre-registry menu order and hides hidden commands", () => {
    const entries = slashMenuEntries(buildCommandRegistry());
    expect(entries.map((e) => e.name)).toEqual([
      "/model",
      "/thinking",
      "/mcp",
      "/skill",
      "/agents",
      "/status",
      "/update",
      "/compact",
      "/resume",
      "/provider",
      "/theme",
      "/graph",
      "/task",
      "/exit",
    ]);
    expect(entries.every((e) => e.desc.length > 0)).toBe(true);
  });

  it("filters by prefix the way the menu does", () => {
    const entries = slashMenuEntries(buildCommandRegistry());
    expect(entries.filter((e) => e.name.startsWith("/m")).map((e) => e.name)).toEqual([
      "/model",
      "/mcp",
    ]);
  });
});
