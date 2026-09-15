import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { McpServerConfig } from "@luckycli/core";
import { mcpInspectLines, mcpListLines, mcpStatusLines, runMcpCommand } from "./mcp-cli.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureServer = resolve(here, "../../core/src/mcp/__fixtures__/stdio-server.mjs");

describe("mcpListLines", () => {
  it("reports an empty state when nothing is configured", () => {
    expect(mcpListLines({})).toEqual(["No MCP servers configured."]);
  });

  it("renders local and remote servers with enabled state and target", () => {
    const lines = mcpListLines({
      docs: { type: "local", command: ["npx", "-y", "@example/docs"] },
      api: { type: "remote", url: "https://example.com/mcp", enabled: false },
    });
    expect(lines[0]).toContain("docs");
    expect(lines[0]).toContain("local");
    expect(lines[0]).toContain("enabled");
    expect(lines[0]).toContain("npx -y @example/docs");
    expect(lines[1]).toContain("remote");
    expect(lines[1]).toContain("disabled");
    expect(lines[1]).toContain("https://example.com/mcp");
  });
});

describe("mcpStatusLines", () => {
  it("shows tool counts for connected servers and errors for failures", () => {
    const lines = mcpStatusLines(
      { docs: { status: "connected" }, api: { status: "failed", error: "401 unauthorized" } },
      { docs: 3, api: 0 },
    );
    expect(lines[0]).toContain("connected");
    expect(lines[0]).toContain("3 tools");
    expect(lines[1]).toContain("failed");
    expect(lines[1]).toContain("401 unauthorized");
  });
});

describe("runMcpCommand", () => {
  it("formats prompt and resource capability details", () => {
    expect(
      mcpInspectLines(
        "docs",
        [{ name: "greet", description: "Greets a person." }],
        [{ name: "guide", uri: "docs://guide", mimeType: "text/plain" }],
      ),
    ).toEqual([
      "docs  connected",
      "prompts:",
      "  greet  Greets a person.",
      "resources:",
      "  guide  docs://guide  text/plain",
    ]);
  });

  it("lists configured servers from injected config", async () => {
    const out: string[] = [];
    const mcp: Record<string, McpServerConfig> = {
      docs: { type: "local", command: ["node", fixtureServer] },
    };
    const code = await runMcpCommand(["list"], { mcp, out: (l) => out.push(l) });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("docs");
  });

  it("connects and reports live status for `status`", async () => {
    const out: string[] = [];
    const mcp: Record<string, McpServerConfig> = {
      docs: { type: "local", command: ["node", fixtureServer], timeout: 5_000 },
    };
    const code = await runMcpCommand(["status"], { mcp, out: (l) => out.push(l) });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("connected");
    expect(out.join("\n")).toContain("2 tools");
  });

  it("inspects prompts and resources for one live server", async () => {
    const out: string[] = [];
    const mcp: Record<string, McpServerConfig> = {
      docs: { type: "local", command: ["node", fixtureServer], timeout: 5_000 },
    };
    const code = await runMcpCommand(["inspect", "docs"], { mcp, out: (l) => out.push(l) });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("greet");
    expect(out.join("\n")).toContain("test://greeting");
  });

  it("rejects inspect without a configured server", async () => {
    const err: string[] = [];
    const code = await runMcpCommand(["inspect", "ghost"], { mcp: {}, err: (l) => err.push(l) });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain('No MCP server named "ghost"');
  });

  it("rejects an unknown subcommand with exit code 1", async () => {
    const err: string[] = [];
    const code = await runMcpCommand(["bogus"], { mcp: {}, err: (l) => err.push(l) });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("Unknown mcp command");
  });
});
