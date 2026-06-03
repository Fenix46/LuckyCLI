import { describe, expect, it } from "vitest";
import { catalogDetailToPreset } from "./presets.js";

describe("catalogDetailToPreset", () => {
  it("rejects a remote-only registry entry with a clear, actionable error", () => {
    // The runtime can't connect to remote transports yet, so installing one
    // would persist a config that always fails. Reject instead of producing it.
    expect(() =>
      catalogDetailToPreset({
        name: "com.example/analytics",
        title: "Analytics",
        remotes: [{ type: "streamable-http", url: "https://example.com/mcp" }],
      }),
    ).toThrow(/remote MCP server/i);
  });

  it("prefers the installable npm stdio package over a remote transport", () => {
    expect(
      catalogDetailToPreset({
        name: "io.github.example/hybrid",
        remotes: [{ type: "streamable-http", url: "https://example.com/mcp" }],
        packages: [
          {
            registryType: "npm",
            identifier: "@example/hybrid",
            transport: { type: "stdio" },
          },
        ],
      }),
    ).toMatchObject({
      config: {
        type: "local",
        command: ["npx", "-y", "@example/hybrid"],
      },
    });
  });

  it("maps an npm stdio package into a Lucky local config", () => {
    expect(
      catalogDetailToPreset({
        name: "io.github.example/docs-search",
        packages: [
          {
            registryType: "npm",
            identifier: "@example/docs-search",
            transport: { type: "stdio" },
          },
        ],
      }),
    ).toMatchObject({
      config: {
        type: "local",
        command: ["npx", "-y", "@example/docs-search"],
      },
    });
  });
});
