import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fromMcpJsonEntry,
  loadProjectMcpJson,
  normalizeMcpServers,
  parseMcpAddArgs,
  withMcpServer,
  withoutMcpServer,
} from "./config.js";
import type { StoredConfig } from "../config/store.js";

describe("mcp config helpers", () => {
  it("normalizes a raw config record by dropping invalid entries", () => {
    expect(
      normalizeMcpServers({
        local_ok: { type: "local", command: ["node", "server.js"] },
        remote_ok: { type: "remote", url: "https://example.com/mcp" },
        broken: { type: "local", command: "node server.js" },
      }),
    ).toEqual({
      local_ok: { type: "local", command: ["node", "server.js"] },
      remote_ok: { type: "remote", url: "https://example.com/mcp" },
    });
  });

  it("adds or replaces one server without mutating the input config", () => {
    const cfg: StoredConfig = {
      mcp: {
        docs: { type: "remote", url: "https://example.com/mcp" },
      },
    };

    const next = withMcpServer(cfg, "local_everything", {
      type: "local",
      command: ["npx", "-y", "@modelcontextprotocol/server-everything"],
    });

    expect(next.mcp).toEqual({
      docs: { type: "remote", url: "https://example.com/mcp" },
      local_everything: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-everything"],
      },
    });
    expect(cfg.mcp).toEqual({
      docs: { type: "remote", url: "https://example.com/mcp" },
    });
  });

  it("removes one configured server immutably", () => {
    const cfg: StoredConfig = {
      mcp: {
        docs: { type: "remote", url: "https://example.com/mcp" },
        local_everything: { type: "local", command: ["node", "server.js"] },
      },
    };

    const next = withoutMcpServer(cfg, "docs");

    expect(next.mcp).toEqual({
      local_everything: { type: "local", command: ["node", "server.js"] },
    });
    expect(cfg.mcp).toEqual({
      docs: { type: "remote", url: "https://example.com/mcp" },
      local_everything: { type: "local", command: ["node", "server.js"] },
    });
  });

  it("returns the original config when removing an unknown server", () => {
    const cfg: StoredConfig = {};
    expect(withoutMcpServer(cfg, "missing")).toBe(cfg);
  });
});

describe("parseMcpAddArgs", () => {
  it("parses a local server with env vars and its own flags after --", () => {
    expect(parseMcpAddArgs(["files", "--env", "ROOT=/srv", "--", "npx", "-y", "files-mcp", "--readonly"])).toEqual({
      name: "files",
      server: { type: "local", command: ["npx", "-y", "files-mcp", "--readonly"], environment: { ROOT: "/srv" } },
    });
    expect(parseMcpAddArgs(["git", "uvx", "mcp-server-git"])).toEqual({
      name: "git",
      server: { type: "local", command: ["uvx", "mcp-server-git"] },
    });
  });

  it("parses a remote server with headers", () => {
    expect(parseMcpAddArgs(["docs", "--header", "Authorization: Bearer x", "https://docs.example/mcp"])).toEqual({
      name: "docs",
      server: { type: "remote", url: "https://docs.example/mcp", headers: { Authorization: "Bearer x" } },
    });
  });

  it("explains what is wrong", () => {
    expect(parseMcpAddArgs([])).toHaveProperty("error");
    expect(parseMcpAddArgs(["only-name"])).toHaveProperty("error");
    expect(parseMcpAddArgs(["x", "--env", "NOEQUALS", "--", "cmd"])).toMatchObject({ error: expect.stringContaining("KEY=VALUE") });
    expect(parseMcpAddArgs(["x", "--header", "A: b", "--", "cmd"])).toMatchObject({ error: expect.stringContaining("remote") });
  });
});

describe("fromMcpJsonEntry", () => {
  it("maps the .mcp.json shapes and drops unknown ones", () => {
    expect(fromMcpJsonEntry({ command: "node", args: ["s.js"], disabled: true })).toEqual({
      type: "local",
      command: ["node", "s.js"],
      enabled: false,
    });
    expect(fromMcpJsonEntry({ type: "sse", url: "https://x/sse" })).toEqual({ type: "remote", url: "https://x/sse" });
    expect(fromMcpJsonEntry({ nothing: true })).toBeUndefined();
  });

  it("accepts explicit stdio, http and streamable-http types", () => {
    expect(fromMcpJsonEntry({ type: "stdio", command: "node", args: ["s.js"], env: { A: "1" } })).toEqual({
      type: "local",
      command: ["node", "s.js"],
      environment: { A: "1" },
    });
    expect(fromMcpJsonEntry({ type: "http", url: "https://x/mcp", headers: { A: "b" } })).toEqual({
      type: "remote",
      url: "https://x/mcp",
      headers: { A: "b" },
    });
    expect(fromMcpJsonEntry({ type: "streamable-http", url: "https://x/mcp" })).toEqual({
      type: "remote",
      url: "https://x/mcp",
    });
  });

  it("ignores transports it cannot speak", () => {
    expect(fromMcpJsonEntry({ type: "websocket", url: "wss://x/mcp" })).toBeUndefined();
    expect(fromMcpJsonEntry({ type: "sdk", command: "node" })).toBeUndefined();
  });
});

describe("loadProjectMcpJson", () => {
  function withConfig(value: unknown): string {
    const cwd = mkdtempSync(join(tmpdir(), "lucky-mcp-json-"));
    writeFileSync(join(cwd, ".mcp.json"), JSON.stringify(value), "utf8");
    return cwd;
  }

  it("reads the wrapped mcpServers shape", () => {
    const cwd = withConfig({
      mcpServers: { local: { command: "npx", args: ["-y", "server"] } },
    });
    try {
      expect(loadProjectMcpJson(cwd)).toEqual({
        local: { type: "local", command: ["npx", "-y", "server"] },
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("reads a bare map and ignores $schema", () => {
    const cwd = withConfig({
      $schema: "https://json.schemastore.org/mcp.json",
      playwright: { command: "npx", args: ["@playwright/mcp@latest"] },
      docs: { type: "http", url: "https://example.com/mcp" },
    });
    try {
      expect(loadProjectMcpJson(cwd)).toEqual({
        playwright: { type: "local", command: ["npx", "@playwright/mcp@latest"] },
        docs: { type: "remote", url: "https://example.com/mcp" },
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("returns an empty map for a missing or malformed file", () => {
    const cwd = mkdtempSync(join(tmpdir(), "lucky-mcp-json-"));
    try {
      expect(loadProjectMcpJson(cwd)).toEqual({});
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
