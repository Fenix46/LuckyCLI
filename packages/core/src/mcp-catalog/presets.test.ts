import { describe, expect, it } from "vitest";
import { catalogDetailToPreset } from "./presets.js";

describe("catalogDetailToPreset", () => {
  it("maps a remote-only registry entry into a Lucky remote config", () => {
    expect(
      catalogDetailToPreset({
        name: "com.example/analytics",
        title: "Analytics",
        remotes: [{ type: "streamable-http", url: "https://example.com/mcp" }],
      }),
    ).toMatchObject({
      name: "com.example/analytics",
      config: { type: "remote", url: "https://example.com/mcp" },
    });
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
