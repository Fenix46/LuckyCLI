import { describe, expect, it } from "vitest";
import { resolveConfig } from "./config.js";
import type { StoredConfig } from "./store.js";

describe("resolveConfig", () => {
  it("carries valid stored MCP config into the resolved runtime config", () => {
    const stored: StoredConfig = {
      mcp: {
        local_everything: {
          type: "local",
          command: ["npx", "-y", "@modelcontextprotocol/server-everything"],
        },
        remote_docs: {
          type: "remote",
          url: "https://example.com/mcp",
          headers: { Authorization: "Bearer test" },
        },
      },
    };

    const resolved = resolveConfig({}, stored, {});

    expect(resolved.mcp).toEqual(stored.mcp);
  });

  it("drops malformed stored MCP entries instead of propagating them", () => {
    const stored = {
      mcp: {
        ok: { type: "local", command: ["node", "server.js"] },
        broken: { type: "remote" },
      },
    } as unknown as StoredConfig;

    const resolved = resolveConfig({}, stored, {});

    expect(resolved.mcp).toEqual({
      ok: { type: "local", command: ["node", "server.js"] },
    });
  });

  it("always resolves an MCP record, even when config is empty", () => {
    expect(resolveConfig({}, {}, {}).mcp).toEqual({});
  });
});
