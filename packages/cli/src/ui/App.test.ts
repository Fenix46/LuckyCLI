import { describe, expect, it } from "vitest";
import { buildMcpCommandRows } from "./App.js";

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
});
