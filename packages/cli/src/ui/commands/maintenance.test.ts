import { describe, expect, it, vi } from "vitest";
import { maintenanceCommands, type MaintenanceCommandDeps } from "./maintenance.js";
import type { Command, CommandContext } from "./types.js";
import type { Item } from "../lib/items.js";

interface Harness {
  emitted: Item[];
  ui: Record<string, ReturnType<typeof vi.fn>>;
  deps: MaintenanceCommandDeps;
  run(name: string, args?: string): Promise<void> | void;
}

function harness(overrides: {
  agent?: Record<string, unknown>;
  deps?: Partial<MaintenanceCommandDeps>;
} = {}): Harness {
  const emitted: Item[] = [];
  const ui = {
    exit: vi.fn(),
    setCompacting: vi.fn(),
    setContextStatus: vi.fn(),
    persistSession: vi.fn(),
  };
  const deps: MaintenanceCommandDeps = {
    checkForUpdate: vi.fn(async () => ({ updateAvailable: false })),
    applyUpdateNow: vi.fn(async () => ({ applied: true })),
    detectSelfUpdate: vi.fn(() => ({ ok: true })),
    loadConfig: vi.fn(() => ({})),
    saveConfig: vi.fn(),
    buildGraph: vi.fn(async () => ({
      fileCount: 1,
      nodeCount: 2,
      edgeCount: 3,
      droppedEdges: 0,
      path: "/tmp/graph.json",
    })),
    recordGraphBuilt: vi.fn(),
    ...overrides.deps,
  } as MaintenanceCommandDeps;
  const ctx = {
    agent: overrides.agent ?? {},
    meta: { provider: "claude", model: "claude-sonnet-4-6" },
    emit: (...items: Item[]) => emitted.push(...items),
    setInput: () => {},
    state: { activeThemeId: "lucky-dark", sessionId: null, taskListId: "t", contextStatus: null },
    ui,
  } as unknown as CommandContext;
  const commands = maintenanceCommands(deps);
  const run = (name: string, args = "") => {
    const command = commands.find((c: Command) => c.name === name);
    if (!command) throw new Error(`no such command: ${name}`);
    return command.run(args, ctx);
  };
  return { emitted, ui, deps, run };
}

describe("/update auto", () => {
  it("rejects unknown policies with usage", async () => {
    const h = harness();
    await h.run("/update", "auto sometimes");
    expect(h.emitted).toEqual([
      { kind: "error", text: "usage: /update auto <off|notify|auto>" },
    ]);
    expect(h.deps.saveConfig).not.toHaveBeenCalled();
  });

  it("persists a valid policy", async () => {
    const h = harness();
    await h.run("/update", "auto notify");
    expect(h.deps.saveConfig).toHaveBeenCalledOnce();
    expect(h.emitted).toEqual([
      { kind: "command", title: "Update", rows: [{ label: "policy", value: "notify" }] },
    ]);
  });
});

describe("/update apply", () => {
  it("installs and exits when an update is available", async () => {
    const h = harness({
      deps: {
        checkForUpdate: vi.fn(async () => ({
          updateAvailable: true,
          latestVersion: "0.4.0",
        })) as MaintenanceCommandDeps["checkForUpdate"],
      },
    });
    await h.run("/update", "apply");
    expect(h.deps.applyUpdateNow).toHaveBeenCalled();
    expect(h.ui.exit).toHaveBeenCalledOnce();
    const item = h.emitted[0]!;
    if (item.kind !== "command") throw new Error("expected command item");
    expect(item.title).toBe("Updated");
  });

  it("reports when self-update is not possible", async () => {
    const h = harness({
      deps: {
        checkForUpdate: vi.fn(async () => ({
          updateAvailable: true,
          latestVersion: "0.4.0",
        })) as MaintenanceCommandDeps["checkForUpdate"],
        applyUpdateNow: vi.fn(async () => ({
          applied: false,
          reason: "managed install",
          installCommand: "npm i -g luckycli",
        })) as MaintenanceCommandDeps["applyUpdateNow"],
      },
    });
    await h.run("/update", "apply");
    expect(h.ui.exit).not.toHaveBeenCalled();
    const item = h.emitted[0]!;
    if (item.kind !== "command") throw new Error("expected command item");
    expect(item.rows).toEqual([
      { label: "status", value: "cannot self-update (managed install)" },
      { label: "command", value: "npm i -g luckycli" },
    ]);
  });
});

describe("/compact", () => {
  it("compacts, refreshes context, persists and reports", async () => {
    const contextStatus = { contextWindow: 100 };
    const h = harness({
      agent: {
        compactNow: vi.fn(async () => ({
          removedMessages: 4,
          keptMessages: 2,
          beforeTokens: 9000,
          afterTokens: 1000,
        })),
        contextStatus: vi.fn(async () => contextStatus),
      },
    });
    await h.run("/compact");
    expect(h.ui.setCompacting.mock.calls).toEqual([[true], [false]]);
    expect(h.ui.setContextStatus).toHaveBeenCalledWith(contextStatus);
    expect(h.ui.persistSession).toHaveBeenCalledOnce();
    const item = h.emitted[0]!;
    if (item.kind !== "command") throw new Error("expected command item");
    expect(item.rows).toEqual([
      { label: "removed", value: "4 messages" },
      { label: "kept", value: "2 messages" },
      { label: "tokens", value: "9,000 -> 1,000" },
    ]);
  });

  it("always clears the compacting flag on failure", async () => {
    const h = harness({
      agent: {
        compactNow: vi.fn(async () => {
          throw new Error("model unavailable");
        }),
      },
    });
    await h.run("/compact");
    expect(h.ui.setCompacting.mock.calls).toEqual([[true], [false]]);
    expect(h.emitted).toEqual([{ kind: "error", text: "model unavailable" }]);
  });
});

describe("/graph", () => {
  it("emits the building row then the summary", async () => {
    const h = harness();
    h.run("/graph");
    expect(h.emitted[0]).toEqual({
      kind: "command",
      title: "Graph",
      rows: [{ label: "building", value: "scanning project files…" }],
    });
    await vi.waitFor(() => expect(h.emitted).toHaveLength(2));
    const built = h.emitted[1]!;
    if (built.kind !== "command") throw new Error("expected command item");
    expect(built.title).toBe("Graph built");
    expect(h.deps.recordGraphBuilt).toHaveBeenCalled();
  });

  it("rejects unknown subcommands", () => {
    const h = harness();
    h.run("/graph", "destroy");
    expect(h.emitted).toEqual([
      { kind: "error", text: "unknown command: /graph destroy. Try /help." },
    ]);
  });
});
