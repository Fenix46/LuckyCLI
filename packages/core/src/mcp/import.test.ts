import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  claudeDesktopConfigPath,
  collectImportableServers,
  readClaudeDesktopMcp,
  readClaudeProjectMcp,
  readClaudeUserMcp,
  readCursorMcp,
} from "./import.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "lucky-mcp-import-"));
  temps.push(dir);
  return dir;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value), "utf8");
}

function writeClaude(home: string, value: unknown): void {
  writeJson(join(home, ".claude.json"), value);
}

describe("readClaudeUserMcp", () => {
  it("reads the user-scope servers", () => {
    const home = temp();
    writeClaude(home, {
      mcpServers: {
        rea: { type: "stdio", command: "/opt/homebrew/bin/rea", args: ["mcp"], env: { A: "1" } },
        docs: { type: "http", url: "https://example.com/mcp" },
      },
    });

    expect(readClaudeUserMcp(home)).toEqual([
      {
        name: "rea",
        origin: "claude",
        config: { type: "local", command: ["/opt/homebrew/bin/rea", "mcp"], environment: { A: "1" } },
      },
      {
        name: "docs",
        origin: "claude",
        config: { type: "remote", url: "https://example.com/mcp" },
      },
    ]);
  });

  it("skips a missing or corrupt file and invalid entries", () => {
    const home = temp();
    writeJson(join(home, ".claude.json"), {
      mcpServers: { broken: { type: "remote" }, ok: { command: "node", args: ["server.js"] } },
    });

    expect(readClaudeUserMcp(home).map((s) => s.name)).toEqual(["ok"]);
    expect(readClaudeUserMcp(join(home, "nope"))).toEqual([]);
  });
});

describe("readClaudeProjectMcp", () => {
  it("reads the local-scope servers for the current folder", () => {
    const home = temp();
    const cwd = temp();
    writeClaude(home, {
      projects: {
        [resolve(cwd)]: { mcpServers: { local: { type: "sse", url: "https://example.com/sse" } } },
      },
    });

    expect(readClaudeProjectMcp(home, cwd)).toEqual([
      { name: "local", origin: "claude-project", config: { type: "remote", url: "https://example.com/sse" } },
    ]);
    expect(readClaudeProjectMcp(home, join(cwd, "other"))).toEqual([]);
  });
});

describe("Claude Desktop", () => {
  it("resolves the config path per platform", () => {
    expect(claudeDesktopConfigPath("/h", "darwin")).toContain(
      join("Library", "Application Support", "Claude"),
    );
    expect(claudeDesktopConfigPath("/h", "win32")).toContain(join("AppData", "Roaming", "Claude"));
    expect(claudeDesktopConfigPath("/h", "linux")).toContain(join(".config", "Claude"));
  });

  it("reads desktop servers from the platform path", () => {
    const home = temp();
    writeJson(claudeDesktopConfigPath(home, "linux"), {
      mcpServers: { desktop: { command: "npx", args: ["-y", "desk"] } },
    });

    expect(readClaudeDesktopMcp(home, "linux").map((s) => s.name)).toEqual(["desktop"]);
  });
});

describe("Cursor", () => {
  it("reads the user-scope config", () => {
    const home = temp();
    writeJson(join(home, ".cursor", "mcp.json"), {
      mcpServers: { cursor: { url: "https://example.com/mcp" } },
    });
    expect(readCursorMcp(home)).toEqual([
      { name: "cursor", origin: "cursor", config: { type: "remote", url: "https://example.com/mcp" } },
    ]);
  });
});

describe("collectImportableServers", () => {
  it("deduplicates by name with the earlier source winning", () => {
    const home = temp();
    const cwd = temp();
    writeClaude(home, { mcpServers: { shared: { command: "claude-server" } } });
    writeJson(claudeDesktopConfigPath(home, "linux"), {
      mcpServers: { shared: { command: "desktop-server" }, desktop: { command: "only-desktop" } },
    });
    writeJson(join(cwd, ".cursor", "mcp.json"), {
      mcpServers: { project_cursor: { url: "https://example.com/p" } },
    });

    const servers = collectImportableServers({ home, cwd, platform: "linux" });
    expect(servers.map((s) => [s.name, s.origin])).toEqual([
      ["shared", "claude"],
      ["desktop", "claude-desktop"],
      ["project_cursor", "cursor"],
    ]);
    expect(servers[0]?.config).toEqual({ type: "local", command: ["claude-server"] });
  });
});
