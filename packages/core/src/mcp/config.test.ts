import { describe, expect, it } from "vitest";
import {
  normalizeMcpServers,
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
