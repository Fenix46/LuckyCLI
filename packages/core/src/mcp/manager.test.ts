import { afterEach, describe, expect, it } from "vitest";
import { ToolRegistry } from "../tools/registry.js";
import { McpManager } from "./manager.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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
});
