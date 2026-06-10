import { describe, expect, it, vi } from "vitest";
import type { Task } from "@luckycli/core";
import { basicCommands, type BasicCommandDeps } from "./basic.js";
import { ALL_SLASH_COMMANDS } from "./slash-menu.js";
import type { Command, CommandContext } from "./types.js";
import type { Item } from "../lib/items.js";

interface Harness {
  ctx: CommandContext;
  emitted: Item[];
  ui: { applyTheme: ReturnType<typeof vi.fn>; exit: ReturnType<typeof vi.fn> };
  deps: BasicCommandDeps;
  run(name: string, args?: string): Promise<void> | void;
}

function harness(overrides: {
  state?: Partial<CommandContext["state"]>;
  meta?: CommandContext["meta"];
  deps?: Partial<BasicCommandDeps>;
} = {}): Harness {
  const emitted: Item[] = [];
  const ui = { applyTheme: vi.fn(), exit: vi.fn() };
  const deps: BasicCommandDeps = {
    listSessions: vi.fn(() => []),
    listTasks: vi.fn(() => []),
    resetTaskList: vi.fn(),
    loadConfig: vi.fn(() => ({})),
    ...overrides.deps,
  } as BasicCommandDeps;
  const ctx = {
    agent: {},
    meta: overrides.meta ?? { provider: "claude", model: "claude-sonnet-4-6" },
    emit: (...items: Item[]) => emitted.push(...items),
    setInput: () => {},
    state: {
      activeThemeId: "lucky-dark",
      sessionId: null,
      taskListId: "list-1",
      contextStatus: null,
      ...overrides.state,
    },
    ui,
  } as unknown as CommandContext;
  const commands = basicCommands(deps);
  const run = (name: string, args = "") => {
    const command = commands.find((c: Command) => c.name === name);
    if (!command) throw new Error(`no such command: ${name}`);
    return command.run(args, ctx);
  };
  return { ctx, emitted, ui, deps, run };
}

describe("/theme", () => {
  it("lists themes marking the active one", () => {
    const h = harness({ state: { activeThemeId: "lucky-dark" } });
    h.run("/theme");
    expect(h.emitted).toHaveLength(1);
    const item = h.emitted[0]!;
    if (item.kind !== "command") throw new Error("expected command item");
    expect(item.title).toBe("Themes");
    const active = item.rows.filter((r) => r.label === "active");
    expect(active).toHaveLength(1);
    expect(active[0]!.value).toContain("lucky-dark");
  });

  it("delegates selection to ui.applyTheme", () => {
    const h = harness();
    h.run("/theme", "dracula");
    expect(h.ui.applyTheme).toHaveBeenCalledWith("dracula");
    expect(h.emitted).toEqual([]);
  });
});

describe("/task", () => {
  it("renders the empty-list hint", () => {
    const h = harness();
    h.run("/task");
    expect(h.emitted).toEqual([
      {
        kind: "command",
        title: "Tasks",
        rows: [{ label: "none", value: "no tasks yet — ask lucky to plan some work" }],
      },
    ]);
  });

  it("renders tasks with in-progress active form", () => {
    const tasks = [
      { id: "1", status: "completed", subject: "ship it" },
      { id: "2", status: "in_progress", subject: "test it", activeForm: "testing it" },
    ] as unknown as Task[];
    const h = harness({ deps: { listTasks: vi.fn(() => tasks) } });
    h.run("/task");
    const item = h.emitted[0]!;
    if (item.kind !== "command") throw new Error("expected command item");
    expect(item.rows).toEqual([
      { label: "#1 completed", value: "ship it" },
      { label: "#2 in_progress", value: "test it (testing it)" },
    ]);
  });

  it("clear resets the session's task list and reports it", () => {
    const h = harness({ state: { taskListId: "session-42" } });
    h.run("/task", "clear");
    expect(h.deps.resetTaskList).toHaveBeenCalledWith("session-42");
    expect(h.emitted).toEqual([
      {
        kind: "command",
        title: "Tasks",
        rows: [{ label: "cleared", value: "the task list is now empty" }],
      },
    ]);
  });

  it("rejects other arguments like the old unknown-command branch", () => {
    const h = harness();
    h.run("/task", "bogus");
    expect(h.emitted).toEqual([
      { kind: "error", text: "unknown command: /task bogus. Try /help." },
    ]);
  });
});

describe("/exit", () => {
  it("exits the app", () => {
    const h = harness();
    h.run("/exit");
    expect(h.ui.exit).toHaveBeenCalledOnce();
  });

  it("rejects arguments instead of exiting", () => {
    const h = harness();
    h.run("/exit", "now");
    expect(h.ui.exit).not.toHaveBeenCalled();
    expect(h.emitted[0]).toEqual({
      kind: "error",
      text: "unknown command: /exit now. Try /help.",
    });
  });
});

describe("/sessions", () => {
  it("renders the empty state", () => {
    const h = harness();
    h.run("/sessions");
    const item = h.emitted[0]!;
    if (item.kind !== "command") throw new Error("expected command item");
    expect(item.rows).toEqual([{ label: "none", value: "no saved sessions yet" }]);
  });

  it("marks the current session and caps at 12", () => {
    const sessions = Array.from({ length: 15 }, (_, i) => ({
      id: `s${i}`,
      messageCount: i,
      title: i === 0 ? undefined : `session ${i}`,
    }));
    const h = harness({
      state: { sessionId: "s0" },
      deps: { listSessions: vi.fn(() => sessions) as BasicCommandDeps["listSessions"] },
    });
    h.run("/sessions");
    const item = h.emitted[0]!;
    if (item.kind !== "command") throw new Error("expected command item");
    expect(item.rows).toHaveLength(12);
    expect(item.rows[0]).toEqual({ label: "current", value: "0 msgs · (untitled)" });
    expect(item.rows[1]).toEqual({ label: "s1", value: "1 msgs · session 1" });
  });
});

describe("/help", () => {
  it("lists the slash-menu catalog", () => {
    const h = harness();
    h.run("/help");
    const item = h.emitted[0]!;
    if (item.kind !== "command") throw new Error("expected command item");
    expect(item.title).toBe("Commands");
    expect(item.rows).toEqual(
      ALL_SLASH_COMMANDS.map((cmd) => ({ label: cmd.name, value: cmd.desc })),
    );
  });
});

describe("/config", () => {
  it("renders provider capabilities and context window", () => {
    const h = harness({
      state: { contextStatus: { contextWindow: 200000 } as CommandContext["state"]["contextStatus"] },
    });
    h.run("/config");
    const item = h.emitted[0]!;
    if (item.kind !== "command") throw new Error("expected command item");
    expect(item.title).toBe("Config");
    const labels = item.rows.map((r) => r.label);
    expect(labels).toContain("provider");
    expect(labels).toContain("model");
    expect(labels).toContain("effort");
    expect(labels).toContain("thinking");
    expect(item.rows.find((r) => r.label === "context")?.value).toBe("200,000 tokens");
    expect(item.rows.find((r) => r.label === "model")?.value).toBe("claude-sonnet-4-6");
  });
});
