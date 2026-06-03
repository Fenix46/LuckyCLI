import { describe, expect, it } from "vitest";
import {
  isMcpServerConfig,
  parseMcpServerConfigRecord,
  type McpServerConfig,
} from "./types.js";

describe("mcp types", () => {
  it("accepts valid local server configs", () => {
    const config: McpServerConfig = {
      type: "local",
      command: ["npx", "-y", "@modelcontextprotocol/server-everything"],
      environment: { FOO: "bar" },
      enabled: true,
      timeout: 5_000,
    };
    expect(isMcpServerConfig(config)).toBe(true);
  });

  it("accepts valid remote server configs", () => {
    const config: McpServerConfig = {
      type: "remote",
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer x" },
      enabled: false,
      timeout: 10_000,
    };
    expect(isMcpServerConfig(config)).toBe(true);
  });

  it("rejects malformed entries", () => {
    expect(isMcpServerConfig(null)).toBe(false);
    expect(isMcpServerConfig({})).toBe(false);
    expect(isMcpServerConfig({ type: "local", command: "npx" })).toBe(false);
    expect(isMcpServerConfig({ type: "remote" })).toBe(false);
  });

  it("filters invalid entries when parsing records", () => {
    expect(
      parseMcpServerConfigRecord({
        local_ok: { type: "local", command: ["node", "server.js"] },
        remote_ok: { type: "remote", url: "https://example.com/mcp" },
        broken: { type: "local", command: "node server.js" },
        junk: 42,
      }),
    ).toEqual({
      local_ok: { type: "local", command: ["node", "server.js"] },
      remote_ok: { type: "remote", url: "https://example.com/mcp" },
    });
  });

  it("returns an empty record for non-object input", () => {
    expect(parseMcpServerConfigRecord(undefined)).toEqual({});
    expect(parseMcpServerConfigRecord("nope")).toEqual({});
  });
});
