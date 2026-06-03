import { describe, expect, it } from "vitest";
import { buildInstalledMcpRows, buildMcpCommandRows } from "./App.js";

describe("buildMcpCommandRows", () => {
  it("renders an empty-state row set when no MCP servers are configured", () => {
    expect(buildMcpCommandRows({}, 0)).toEqual([
      { label: "servers", value: "none configured for this session" },
      { label: "tools", value: "0" },
    ]);
  });

  it("renders per-server MCP status rows", () => {
    expect(
      buildMcpCommandRows(
        {
          docs: { status: "connected" },
          github: { status: "failed", error: "401 unauthorized" },
        },
        4,
      ),
    ).toEqual([
      { label: "tools", value: "4" },
      { label: "docs", value: "connected" },
      { label: "github", value: "failed · 401 unauthorized" },
    ]);
  });

  it("renders installed MCP rows with config + runtime status", () => {
    expect(
      buildInstalledMcpRows(
        {
          docs: { type: "local", command: ["node", "server.js"] },
          remote_api: { type: "remote", url: "https://example.com/mcp", enabled: false },
        },
        {
          docs: { status: "connected" },
          remote_api: { status: "failed", error: "401 unauthorized" },
        },
      ),
    ).toEqual([
      {
        name: "docs",
        summary: "enabled · connected · node server.js",
      },
      {
        name: "remote_api",
        summary: "disabled · failed · 401 unauthorized · https://example.com/mcp",
      },
    ]);
  });
});
