import { describe, expect, it, vi } from "vitest";
import { installCatalogServer, mcpCommands, type McpCommandDeps } from "./mcp.js";
import type { Command, CommandContext } from "./types.js";
import type { Item } from "../lib/items.js";

const detail = {
  name: "context7",
  title: "Context7",
  description: "Live docs for libraries",
  version: "1.2.3",
  // catalogDetailToPreset reads the remote/package shape; keep it minimal and
  // url-based so the preset comes out as a remote server.
  remotes: [{ type: "streamable-http", url: "https://mcp.context7.com/mcp" }],
};

function fakeDeps(overrides: Partial<McpCommandDeps> = {}): McpCommandDeps {
  return {
    createCatalog: () => ({ get: vi.fn(async () => detail) }),
    loadConfig: vi.fn(() => ({})),
    saveConfig: vi.fn(),
    ...overrides,
  } as McpCommandDeps;
}

interface Harness {
  emitted: Item[];
  ui: { openMcpPanel: ReturnType<typeof vi.fn>; setMcpConfig: ReturnType<typeof vi.fn> };
  run(args: string): Promise<void> | void;
}

function harness(deps: McpCommandDeps = fakeDeps()): Harness {
  const emitted: Item[] = [];
  const ui = { openMcpPanel: vi.fn(), setMcpConfig: vi.fn() };
  const ctx = {
    agent: {},
    meta: { provider: "claude", model: "claude-sonnet-4-6" },
    emit: (...items: Item[]) => emitted.push(...items),
    setInput: () => {},
    state: { activeThemeId: "lucky-dark", sessionId: null, taskListId: "t", contextStatus: null },
    ui,
  } as unknown as CommandContext;
  const command = mcpCommands(deps).find((c: Command) => c.name === "/mcp")!;
  return { emitted, ui, run: (args: string) => command.run(args, ctx) };
}

describe("/mcp", () => {
  it("opens the installed tab for the bare command and status/list", async () => {
    const h = harness();
    await h.run("");
    await h.run("status");
    await h.run("list");
    expect(h.ui.openMcpPanel.mock.calls).toEqual([
      ["installed"],
      ["installed"],
      ["installed"],
    ]);
  });

  it("opens the search tab with the query", async () => {
    const h = harness();
    await h.run("search browser tools");
    expect(h.ui.openMcpPanel).toHaveBeenCalledWith("search", "browser tools");
  });

  it("shows catalog details for a named server", async () => {
    const h = harness();
    await h.run("show context7");
    const item = h.emitted[0]!;
    if (item.kind !== "command") throw new Error("expected command item");
    expect(item.title).toBe("MCP Server: context7");
    expect(item.rows.map((r) => r.label)).toEqual([
      "title",
      "description",
      "version",
      "preset",
    ]);
  });

  it("requires a name for show", async () => {
    const h = harness();
    await h.run("show");
    expect(h.emitted).toEqual([
      { kind: "error", text: "usage: /mcp show <server-name>" },
    ]);
  });

  it("adds a catalog server: persists config and reports", async () => {
    const deps = fakeDeps();
    const h = harness(deps);
    await h.run("add context7");
    expect(deps.saveConfig).toHaveBeenCalledOnce();
    expect(h.ui.setMcpConfig).toHaveBeenCalledOnce();
    const item = h.emitted[0]!;
    if (item.kind !== "command") throw new Error("expected command item");
    expect(item.title).toBe("MCP Added");
    expect(item.rows[0]).toEqual({ label: "server", value: "context7" });
  });

  it("surfaces catalog failures on add as error items", async () => {
    const deps = fakeDeps({
      createCatalog: () => ({
        get: vi.fn(async () => {
          throw new Error("server not found in registry");
        }),
      }),
    });
    const h = harness(deps);
    await h.run("add nope");
    expect(h.emitted).toEqual([
      { kind: "error", text: "server not found in registry" },
    ]);
  });

  it("rejects unknown subcommands", async () => {
    const h = harness();
    await h.run("frobnicate");
    expect(h.emitted).toEqual([
      { kind: "error", text: "unknown command: /mcp frobnicate. Try /help." },
    ]);
  });
});

describe("installCatalogServer", () => {
  it("propagates the merged config to the live manager", async () => {
    const saved: unknown[] = [];
    const applied: unknown[] = [];
    const emitted: Item[] = [];
    const deps = fakeDeps({
      loadConfig: vi.fn(() => ({ mcp: { existing: { type: "remote", url: "https://x" } } })) as McpCommandDeps["loadConfig"],
      saveConfig: vi.fn((next) => saved.push(next)) as McpCommandDeps["saveConfig"],
    });
    await installCatalogServer(
      "context7",
      (next) => applied.push(next),
      (item) => emitted.push(item),
      deps,
    );
    expect(saved).toHaveLength(1);
    expect(applied).toHaveLength(1);
    expect(Object.keys(applied[0] as Record<string, unknown>)).toContain("context7");
    expect(Object.keys(applied[0] as Record<string, unknown>)).toContain("existing");
    expect(emitted[0]!.kind).toBe("command");
  });
});
