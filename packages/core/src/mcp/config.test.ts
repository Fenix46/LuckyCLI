import { describe, expect, it } from "vitest";
import {
  fromMcpJsonEntry,
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
});
