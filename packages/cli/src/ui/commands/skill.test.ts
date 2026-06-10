import { describe, expect, it, vi } from "vitest";
import { skillCommands, type SkillCommandDeps } from "./skill.js";
import type { Command, CommandContext } from "./types.js";
import type { Item } from "../lib/items.js";

const installed = [
  { name: "release-flow", description: "cut a release", keywords: ["release"], related: [], bodyPath: "release-flow/skill.md", enabled: true },
  { name: "npm-publish", description: "publish", keywords: ["npm"], related: [], bodyPath: "npm-publish/skill.md", enabled: false },
];

const catalogResults = [
  { name: "docker-build", description: "build images", keywords: ["docker"], path: "docker-build/skill.md" },
];

function fakeDeps(overrides: Partial<SkillCommandDeps> = {}): SkillCommandDeps {
  return {
    createCatalog: () => ({
      search: vi.fn(async () => catalogResults),
      get: vi.fn(async () => catalogResults[0] ?? null),
      fetchBody: vi.fn(async () => "body"),
    }),
    discover: vi.fn(async () => installed),
    installFromPath: vi.fn(async () => ({ name: "from-path", dir: "/x" })),
    installFromCatalog: vi.fn(async () => ({ name: "docker-build", dir: "/x" })),
    uninstall: vi.fn(async () => true),
    setEnabled: vi.fn(async () => true),
    ...overrides,
  } as SkillCommandDeps;
}

interface Harness {
  emitted: Item[];
  ui: { openSkillPanel: ReturnType<typeof vi.fn> };
  run(args: string): Promise<void> | void;
}

function harness(deps: SkillCommandDeps = fakeDeps()): Harness {
  const emitted: Item[] = [];
  const ui = { openSkillPanel: vi.fn() };
  const ctx = {
    agent: {},
    meta: { provider: "claude", model: "claude-sonnet-4-6" },
    emit: (...items: Item[]) => emitted.push(...items),
    setInput: () => {},
    state: { activeThemeId: "lucky-dark", sessionId: null, taskListId: "t", contextStatus: null },
    ui,
  } as unknown as CommandContext;
  const command = skillCommands(deps).find((c: Command) => c.name === "/skill")!;
  return { emitted, ui, run: (args: string) => command.run(args, ctx) };
}

describe("/skill", () => {
  it("opens the installed panel for the bare command", async () => {
    const h = harness();
    await h.run("");
    expect(h.ui.openSkillPanel).toHaveBeenCalledWith("installed");
  });

  it("lists installed skills inline for `list`", async () => {
    const h = harness();
    await h.run("list");
    const item = h.emitted[0]!;
    if (item.kind !== "command") throw new Error("expected command item");
    expect(item.title).toBe("Installed skills");
    expect(item.rows.map((r) => r.label)).toEqual(["release-flow", "npm-publish"]);
    expect(item.rows[1]?.value).toContain("disabled");
  });

  it("opens the search tab with no query, prints results with a query", async () => {
    const h = harness();
    await h.run("search");
    expect(h.ui.openSkillPanel).toHaveBeenCalledWith("search");
    await h.run("search docker");
    const item = h.emitted[0]!;
    if (item.kind !== "command") throw new Error("expected command item");
    expect(item.rows[0]?.label).toBe("docker-build");
  });

  it("installs from a local path when the arg looks like a path", async () => {
    const deps = fakeDeps();
    const h = harness(deps);
    await h.run("add ./my-skill");
    expect(deps.installFromPath).toHaveBeenCalledWith("./my-skill");
    expect(deps.installFromCatalog).not.toHaveBeenCalled();
    const item = h.emitted[0]!;
    if (item.kind !== "command") throw new Error("expected command item");
    expect(item.title).toBe("Skill installed");
  });

  it("installs from the catalog when the arg is a bare name", async () => {
    const deps = fakeDeps();
    const h = harness(deps);
    await h.run("add docker-build");
    expect(deps.installFromCatalog).toHaveBeenCalledWith("docker-build");
    expect(deps.installFromPath).not.toHaveBeenCalled();
  });

  it("surfaces install failures as error items", async () => {
    const deps = fakeDeps({
      installFromCatalog: vi.fn(async () => {
        throw new Error("already installed");
      }) as SkillCommandDeps["installFromCatalog"],
    });
    const h = harness(deps);
    await h.run("add docker-build");
    expect(h.emitted).toEqual([{ kind: "error", text: "already installed" }]);
  });

  it("enables and disables by name", async () => {
    const deps = fakeDeps();
    const h = harness(deps);
    await h.run("disable release-flow");
    expect(deps.setEnabled).toHaveBeenCalledWith("release-flow", false);
    const item = h.emitted[0]!;
    if (item.kind !== "command") throw new Error("expected command item");
    expect(item.rows.find((r) => r.label === "enabled")?.value).toBe("false");
  });

  it("reports an unknown skill on enable", async () => {
    const deps = fakeDeps({ setEnabled: vi.fn(async () => false) as SkillCommandDeps["setEnabled"] });
    const h = harness(deps);
    await h.run("enable ghost");
    expect(h.emitted).toEqual([{ kind: "error", text: 'no installed skill named "ghost"' }]);
  });

  it("removes a skill and reports", async () => {
    const deps = fakeDeps();
    const h = harness(deps);
    await h.run("remove release-flow");
    expect(deps.uninstall).toHaveBeenCalledWith("release-flow");
    const item = h.emitted[0]!;
    if (item.kind !== "command") throw new Error("expected command item");
    expect(item.title).toBe("Skill removed");
  });

  it("reports an unknown skill on remove", async () => {
    const deps = fakeDeps({ uninstall: vi.fn(async () => false) as SkillCommandDeps["uninstall"] });
    const h = harness(deps);
    await h.run("remove ghost");
    expect(h.emitted).toEqual([{ kind: "error", text: 'no installed skill named "ghost"' }]);
  });

  it("rejects unknown subcommands", async () => {
    const h = harness();
    await h.run("frobnicate");
    expect(h.emitted).toEqual([
      { kind: "error", text: "unknown command: /skill frobnicate. Try /help." },
    ]);
  });
});
