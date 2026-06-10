import { describe, expect, it, vi } from "vitest";
import { providerCommands, type ProviderCommandDeps } from "./provider.js";
import type { Command, CommandContext } from "./types.js";
import type { Item } from "../lib/items.js";

interface Harness {
  emitted: Item[];
  ui: {
    selectModel: ReturnType<typeof vi.fn>;
    changeModel: ReturnType<typeof vi.fn>;
    triggerSetup: ReturnType<typeof vi.fn>;
    setContextStatus: ReturnType<typeof vi.fn>;
  };
  deps: ProviderCommandDeps;
  run(name: string, args?: string): Promise<void> | void;
}

function harness(overrides: {
  meta?: CommandContext["meta"];
  agent?: Record<string, unknown>;
  deps?: Partial<ProviderCommandDeps>;
} = {}): Harness {
  const emitted: Item[] = [];
  const ui = {
    selectModel: vi.fn(),
    changeModel: vi.fn(),
    triggerSetup: vi.fn(),
    setContextStatus: vi.fn(),
  };
  const deps: ProviderCommandDeps = {
    loadConfig: vi.fn(() => ({})),
    saveThinkingEnabled: vi.fn(),
    ...overrides.deps,
  } as ProviderCommandDeps;
  const ctx = {
    agent: overrides.agent ?? {},
    meta: overrides.meta ?? { provider: "claude", model: "claude-sonnet-4-6" },
    emit: (...items: Item[]) => emitted.push(...items),
    setInput: () => {},
    state: { activeThemeId: "lucky-dark", sessionId: null, taskListId: "t", contextStatus: null },
    ui,
  } as unknown as CommandContext;
  const commands = providerCommands(deps);
  const run = (name: string, args = "") => {
    const command = commands.find((c: Command) => c.name === name);
    if (!command) throw new Error(`no such command: ${name}`);
    return command.run(args, ctx);
  };
  return { emitted, ui, deps, run };
}

describe("/model", () => {
  it("lists provider models marking the active one", () => {
    const h = harness();
    h.run("/model");
    const item = h.emitted[0]!;
    if (item.kind !== "command") throw new Error("expected command item");
    expect(item.title).toBe("Models");
    const active = item.rows.filter((r) => r.label === "active");
    expect(active).toEqual([{ label: "active", value: "claude-sonnet-4-6" }]);
  });

  it("delegates an explicit model to ui.selectModel (picker flow)", () => {
    const h = harness();
    h.run("/model", "claude-fable-5");
    expect(h.ui.selectModel).toHaveBeenCalledWith("claude-fable-5");
    expect(h.emitted).toEqual([]);
  });
});

describe("/thinking", () => {
  it("is rejected for non-Claude providers", () => {
    const h = harness({ meta: { provider: "openai-oauth", model: "gpt-5.5" } });
    h.run("/thinking", "on");
    expect(h.emitted).toEqual([
      { kind: "error", text: "/thinking is currently only supported for Claude." },
    ]);
  });

  it("reports the current setting without args", () => {
    const h = harness();
    h.run("/thinking");
    const item = h.emitted[0]!;
    if (item.kind !== "command") throw new Error("expected command item");
    expect(item.title).toBe("Thinking");
    expect(item.rows[0]).toEqual({ label: "provider", value: "Claude" });
  });

  it("rejects unknown arguments with usage", () => {
    const h = harness();
    h.run("/thinking", "maybe");
    expect(h.emitted).toEqual([
      { kind: "error", text: "Usage: /thinking on | /thinking off" },
    ]);
  });

  it("persists the toggle and rebuilds the agent on the same model", () => {
    const h = harness();
    h.run("/thinking", "on");
    expect(h.deps.saveThinkingEnabled).toHaveBeenCalledWith("claude", true);
    expect(h.ui.changeModel).toHaveBeenCalledWith("claude-sonnet-4-6");
    expect(h.emitted).toEqual([
      { kind: "assistant", text: "Claude thinking enabled." },
    ]);
  });
});

describe("/provider", () => {
  it("announces and opens the provider switcher", () => {
    const h = harness();
    h.run("/provider");
    expect(h.ui.triggerSetup).toHaveBeenCalledOnce();
    const item = h.emitted[0]!;
    if (item.kind !== "command") throw new Error("expected command item");
    expect(item.title).toBe("Provider");
  });

  it("rejects arguments", () => {
    const h = harness();
    h.run("/provider", "claude");
    expect(h.ui.triggerSetup).not.toHaveBeenCalled();
    expect(h.emitted[0]!.kind).toBe("error");
  });
});

describe("/status", () => {
  it("emits the combined status item and refreshes context state", async () => {
    const providerStatus = { provider: "claude" };
    const contextStatus = { contextWindow: 200000 };
    const h = harness({
      agent: {
        providerStatus: vi.fn(async () => providerStatus),
        contextStatus: vi.fn(async () => contextStatus),
      },
    });
    await h.run("/status");
    expect(h.ui.setContextStatus).toHaveBeenCalledWith(contextStatus);
    expect(h.emitted).toEqual([
      { kind: "status", provider: providerStatus, context: contextStatus },
    ]);
  });

  it("surfaces agent failures as error items", async () => {
    const h = harness({
      agent: {
        providerStatus: vi.fn(async () => {
          throw new Error("auth expired");
        }),
        contextStatus: vi.fn(async () => ({})),
      },
    });
    await h.run("/status");
    expect(h.emitted).toEqual([{ kind: "error", text: "auth expired" }]);
  });
});

describe("/context", () => {
  it("emits context rows and refreshes context state", async () => {
    const contextStatus = { contextWindow: 200000, usedTokens: 1000 };
    const h = harness({
      agent: { contextStatus: vi.fn(async () => contextStatus) },
    });
    await h.run("/context");
    expect(h.ui.setContextStatus).toHaveBeenCalledWith(contextStatus);
    const item = h.emitted[0]!;
    if (item.kind !== "command") throw new Error("expected command item");
    expect(item.title).toBe("Context");
    expect(item.rows.length).toBeGreaterThan(0);
  });
});
