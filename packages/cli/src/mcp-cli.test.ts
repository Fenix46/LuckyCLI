import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { McpServerConfig } from "@luckycli/core";
import { mcpImportLines, mcpInspectLines, mcpListLines, mcpStatusLines, parseMcpImportArgs, runMcpCommand } from "./mcp-cli.js";

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
      { docs: { prompts: 1, resources: 2 } },
    );
    expect(lines[0]).toContain("connected");
    expect(lines[0]).toContain("3 tools");
    expect(lines[0]).toContain("1 prompts");
    expect(lines[0]).toContain("2 resources");
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

  it("adds and removes servers in the global config", async () => {
    let stored: { mcp?: Record<string, unknown> } = {};
    const io = {
      mcp: {},
      out: () => {},
      err: () => {},
      loadConfig: () => stored,
      saveConfig: (next: typeof stored) => {
        stored = next;
      },
    } as unknown as Parameters<typeof runMcpCommand>[1];
    expect(await runMcpCommand(["add", "files", "--", "npx", "files-mcp"], io)).toBe(0);
    expect(stored.mcp?.files).toEqual({ type: "local", command: ["npx", "files-mcp"] });
    expect(await runMcpCommand(["remove", "files"], io)).toBe(0);
    expect(stored.mcp?.files).toBeUndefined();
    expect(await runMcpCommand(["remove", "files"], io)).toBe(1);
    expect(await runMcpCommand(["add"], io)).toBe(1);
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
    expect(out.join("\n")).toContain("4 tools");
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

describe("mcp add-json", () => {
  it("adds a server from inline JSON", async () => {
    let stored: { mcp?: Record<string, unknown> } = {};
    const out: string[] = [];
    const io = {
      mcp: {},
      out: (line: string) => out.push(line),
      err: () => {},
      loadConfig: () => stored,
      saveConfig: (next: typeof stored) => {
        stored = next;
      },
    } as unknown as Parameters<typeof runMcpCommand>[1];

    const code = await runMcpCommand(
      ["add-json", "docs", '{"type":"http","url":"https://example.com/mcp"}'],
      io,
    );
    expect(code).toBe(0);
    expect(stored.mcp?.docs).toEqual({ type: "remote", url: "https://example.com/mcp" });
    expect(out.join("\n")).toContain('Added MCP server "docs"');
  });

  it("reads the entry from a file", async () => {
    let stored: { mcp?: Record<string, unknown> } = {};
    const io = {
      mcp: {},
      out: () => {},
      err: () => {},
      loadConfig: () => stored,
      saveConfig: (next: typeof stored) => {
        stored = next;
      },
      readFile: () => '{"command":"npx","args":["-y","files"]}',
    } as unknown as Parameters<typeof runMcpCommand>[1];

    expect(await runMcpCommand(["add-json", "files", "--file", "server.json"], io)).toBe(0);
    expect(stored.mcp?.files).toEqual({ type: "local", command: ["npx", "-y", "files"] });
  });

  it("rejects invalid JSON and an unrecognized entry", async () => {
    const err: string[] = [];
    const io = {
      mcp: {},
      out: () => {},
      err: (line: string) => err.push(line),
      loadConfig: () => ({}),
      saveConfig: () => {},
    } as unknown as Parameters<typeof runMcpCommand>[1];

    expect(await runMcpCommand(["add-json", "x", "{"], io)).toBe(1);
    expect(await runMcpCommand(["add-json", "x", '{"nothing":true}'], io)).toBe(1);
    expect(err.join("\n")).toMatch(/Invalid JSON/);
  });
});

describe("parseMcpImportArgs", () => {
  it("defaults to all sources, disabled, not a dry run", () => {
    expect(parseMcpImportArgs([])).toEqual({
      from: "all",
      dryRun: false,
      enable: false,
      force: false,
    });
  });

  it("parses --from, --dry-run, --enable and --force", () => {
    expect(parseMcpImportArgs(["--from", "cursor", "--dry-run", "--enable", "--force"])).toEqual({
      from: "cursor",
      dryRun: true,
      enable: true,
      force: true,
    });
    expect(parseMcpImportArgs(["--from=claude-desktop"]).from).toBe("claude-desktop");
  });

  it("rejects an unknown source or option", () => {
    expect(parseMcpImportArgs(["--from", "vim"]).error).toMatch(/Unknown source/);
    expect(parseMcpImportArgs(["--wat"]).error).toMatch(/Unknown option/);
  });
});

describe("mcp import", () => {
  const imported = {
    imported: [
      { name: "rea", origin: "claude" as const, config: { type: "local" as const, command: ["rea", "mcp"] } },
      { name: "docs", origin: "cursor" as const, config: { type: "remote" as const, url: "https://example.com/mcp" } },
    ],
    skipped: ["existing"],
    mcp: {},
  };

  it("describes a dry run without claiming to write", () => {
    const lines = mcpImportLines(imported, { dryRun: true, enable: false });
    expect(lines[0]).toContain("Would import 2 MCP servers");
    expect(lines.join("\n")).toContain("rea  claude");
    expect(lines.join("\n")).toContain("Skipped existing");
  });

  it("writes the imported config disabled by default", async () => {
    let stored: { mcp?: Record<string, unknown> } = {};
    const out: string[] = [];
    const io = {
      mcp: {},
      out: (line: string) => out.push(line),
      err: () => {},
      loadConfig: () => stored,
      saveConfig: (next: typeof stored) => {
        stored = next;
      },
      importServers: () => [
        { name: "rea", origin: "claude", config: { type: "local", command: ["rea", "mcp"] } },
      ],
    } as unknown as Parameters<typeof runMcpCommand>[1];

    expect(await runMcpCommand(["import"], io)).toBe(0);
    expect(stored.mcp?.rea).toEqual({
      type: "local",
      command: ["rea", "mcp"],
      enabled: false,
      importedFrom: "claude",
    });
    expect(out.join("\n")).toContain("(disabled");
  });

  it("does not save on a dry run", async () => {
    let saved = false;
    const io = {
      mcp: {},
      out: () => {},
      err: () => {},
      loadConfig: () => ({}),
      saveConfig: () => {
        saved = true;
      },
      importServers: () => [
        { name: "rea", origin: "claude", config: { type: "local", command: ["rea", "mcp"] } },
      ],
    } as unknown as Parameters<typeof runMcpCommand>[1];

    expect(await runMcpCommand(["import", "--dry-run"], io)).toBe(0);
    expect(saved).toBe(false);
  });

  it("skips existing entries unless forced", async () => {
    let stored: { mcp?: Record<string, unknown> } = { mcp: { rea: { type: "local", command: ["mine"] } } };
    const out: string[] = [];
    const io = {
      mcp: {},
      out: (line: string) => out.push(line),
      err: () => {},
      loadConfig: () => stored,
      saveConfig: (next: typeof stored) => {
        stored = next;
      },
      importServers: () => [
        { name: "rea", origin: "claude", config: { type: "local", command: ["rea", "mcp"] } },
        { name: "cursor", origin: "cursor", config: { type: "remote", url: "https://cursor.example/mcp" } },
      ],
    } as unknown as Parameters<typeof runMcpCommand>[1];

    expect(await runMcpCommand(["import"], io)).toBe(0);
    expect(stored.mcp?.cursor).toMatchObject({ importedFrom: "cursor", enabled: false });
    expect(stored.mcp?.rea).toEqual({ type: "local", command: ["mine"] });
    expect(out.join("\n")).toContain("Skipped existing");
  });

  it("rejects an unknown source", async () => {
    const err: string[] = [];
    const code = await runMcpCommand(["import", "--from", "vim"], { mcp: {}, err: (l) => err.push(l) });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("Unknown source");
  });
});
