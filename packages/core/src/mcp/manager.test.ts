import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { ToolRegistry } from "../tools/registry.js";
import { buildAndSaveGraph } from "../graph/build.js";
import { loadGraph } from "../graph/store.js";
import { McpManager } from "./manager.js";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureServer = resolve(here, "__fixtures__/stdio-server.mjs");

describe("McpManager", () => {
  const managers: McpManager[] = [];

  afterEach(async () => {
    await Promise.all(managers.splice(0).map((manager) => manager.close()));
  });

  it("connects configured local MCP servers and reports status", async () => {
    const manager = new McpManager();
    managers.push(manager);

    const status = await manager.connectAll({
      docs: {
        type: "local",
        command: ["node", fixtureServer],
        timeout: 5_000,
      },
      disabled: {
        type: "local",
        command: ["node", fixtureServer],
        enabled: false,
      },
    });

    expect(status).toEqual({
      docs: { status: "connected" },
      disabled: { status: "disabled" },
    });
  });

  it("reports a failed status for an unreachable remote server", async () => {
    const manager = new McpManager();
    managers.push(manager);

    // Port 1 refuses fast and offline, so this is deterministic without network.
    const status = await manager.connectAll({
      remote: {
        type: "remote",
        url: "http://127.0.0.1:1/mcp",
        timeout: 2_000,
      },
    });

    expect(status.remote?.status).toBe("failed");
  });

  it("does not retain a server that connects after the manager is closed", async () => {
    const manager = new McpManager();
    managers.push(manager);

    // Start connecting (background-style) then close before it resolves. The
    // server must not be stored, mirroring a session torn down mid-startup.
    const connecting = manager.connectAll({
      docs: { type: "local", command: ["node", fixtureServer], timeout: 5_000 },
    });
    await manager.close();
    await connecting;

    expect(manager.tools()).toEqual([]);
  });

  it("records disconnected status and drops tools on disconnect, then restores on reconnect", async () => {
    const manager = new McpManager();
    managers.push(manager);
    const config = { type: "local" as const, command: ["node", fixtureServer], timeout: 5_000 };

    await manager.connectAll({ docs: config });
    expect(manager.status().docs).toEqual({ status: "connected" });
    expect(manager.tools().map((t) => t.name)).toContain("docs_echo");

    await manager.disconnect("docs");
    expect(manager.status().docs).toEqual({ status: "disconnected" });
    expect(manager.tools()).toEqual([]);

    const status = await manager.reconnect("docs", config);
    expect(status).toEqual({ status: "connected" });
    expect(manager.tools().map((t) => t.name)).toContain("docs_echo");
  });

  it("exposes adapted Lucky tools that execute through the MCP client", async () => {
    const manager = new McpManager();
    managers.push(manager);

    await manager.connectAll({
      docs: {
        type: "local",
        command: ["node", fixtureServer],
        timeout: 5_000,
      },
    });

    const registry = manager.tools().reduce(
      (acc, tool) => acc.register(tool),
      new ToolRegistry(),
    );

    const result = await registry.execute("docs_echo", { message: "hello" }, { cwd: "/" });

    expect(result).toEqual({ content: "echo:hello" });
  });

  it("lists and fetches prompts and resources from a connected server", async () => {
    const manager = new McpManager();
    managers.push(manager);
    await manager.connectAll({
      docs: { type: "local", command: ["node", fixtureServer], timeout: 5_000 },
    });

    const prompts = await manager.listPrompts("docs");
    expect(prompts.map((p) => p.name)).toContain("greet");
    await expect(manager.getPrompt("docs", "greet", { name: "World" })).resolves.toContain(
      "Hello, World!",
    );

    const resources = await manager.listResources("docs");
    expect(resources.map((r) => r.uri)).toContain("test://greeting");
    await expect(manager.readResource("docs", "test://greeting")).resolves.toBe("hello resource");
  });

  it("throws when querying prompts/resources of a server that is not connected", async () => {
    const manager = new McpManager();
    managers.push(manager);
    await expect(manager.listPrompts("ghost")).rejects.toThrow(/not connected/);
  });

  describe("graph upkeep after MCP edits", () => {
    let root: string;

    afterEach(async () => {
      if (root) await rm(root, { recursive: true, force: true });
    });

    async function connectFsManager(): Promise<McpManager> {
      const manager = new McpManager();
      managers.push(manager);
      await manager.connectAll({
        fs: {
          type: "local",
          command: ["node", fixtureServer],
          environment: { MCP_FIXTURE_ROOT: root },
          timeout: 5_000,
        },
      });
      return manager;
    }

    it("reports files an MCP tool changed so the graph stays fresh", async () => {
      root = await mkdtemp(join(tmpdir(), "lucky-mcp-graph-"));
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src", "a.ts"), `export function alpha() { return 1; }\n`);
      await buildAndSaveGraph(root);

      const manager = await connectFsManager();
      const onFilesChanged = vi.fn();
      const registry = manager.tools().reduce((acc, tool) => acc.register(tool), new ToolRegistry());

      await registry.execute(
        "fs_write_file",
        { path: "src/a.ts", content: `export function renamed() { return 1; }\n` },
        { cwd: root, onFilesChanged },
      );

      expect(onFilesChanged).toHaveBeenCalledWith(["src/a.ts"]);

      // The maintainer pipeline isn't wired here, so drive the update directly
      // to confirm the reported path lands in the graph.
      const { updateGraphForFiles } = await import("../graph/update.js");
      await updateGraphForFiles(root, ["src/a.ts"]);
      const graph = await loadGraph(root);
      const labels = graph.nodes.map((n) => n.label);
      expect(labels).toContain("renamed");
      expect(labels).not.toContain("alpha");
    });

    it("does no graph work when the project has no graph", async () => {
      root = await mkdtemp(join(tmpdir(), "lucky-mcp-nograph-"));
      const manager = await connectFsManager();
      const onFilesChanged = vi.fn();
      const registry = manager.tools().reduce((acc, tool) => acc.register(tool), new ToolRegistry());

      const result = await registry.execute(
        "fs_write_file",
        { path: "note.txt", content: "hi" },
        { cwd: root, onFilesChanged },
      );

      expect(result).toEqual({ content: "wrote:note.txt" });
      expect(onFilesChanged).not.toHaveBeenCalled();
    });
  });
});
