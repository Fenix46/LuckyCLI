import { describe, expect, it } from "vitest";
import { mapAcpMcpServers, mergeMcpServers } from "./sessions.js";

describe("mapAcpMcpServers", () => {
  it("maps stdio servers to local child-process config", () => {
    expect(
      mapAcpMcpServers([
        {
          name: "docs",
          command: "npx",
          args: ["-y", "@example/docs-mcp"],
          env: [{ name: "DOCS_TOKEN", value: "t" }],
        },
      ]),
    ).toEqual({
      docs: {
        type: "local",
        command: ["npx", "-y", "@example/docs-mcp"],
        environment: { DOCS_TOKEN: "t" },
      },
    });
  });

  it("maps http and sse servers to remote config with headers", () => {
    expect(
      mapAcpMcpServers([
        {
          name: "analytics",
          type: "http",
          url: "https://mcp.example.com/mcp",
          headers: [{ name: "Authorization", value: "Bearer x" }],
        },
        { name: "events", type: "sse", url: "https://mcp.example.com/sse", headers: [] },
      ]),
    ).toEqual({
      analytics: {
        type: "remote",
        url: "https://mcp.example.com/mcp",
        headers: { Authorization: "Bearer x" },
      },
      events: { type: "remote", url: "https://mcp.example.com/sse" },
    });
  });

  it("omits empty environment", () => {
    const mapped = mapAcpMcpServers([{ name: "t", command: "bin", args: [], env: [] }]);
    expect(mapped.t).toEqual({ type: "local", command: ["bin"] });
  });
});

describe("mergeMcpServers", () => {
  it("lets the user's own config win on a name conflict", () => {
    const merged = mergeMcpServers(
      { docs: { type: "local", command: ["editor-supplied"] } },
      { docs: { type: "local", command: ["user-pinned"] } },
    );
    expect(merged.docs).toEqual({ type: "local", command: ["user-pinned"] });
  });

  it("keeps disjoint servers from both sides", () => {
    const merged = mergeMcpServers(
      { a: { type: "local", command: ["a"] } },
      { b: { type: "local", command: ["b"] } },
    );
    expect(Object.keys(merged).sort()).toEqual(["a", "b"]);
  });
});
