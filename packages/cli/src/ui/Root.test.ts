import { describe, expect, it } from "vitest";
import type { McpServerConfig } from "@luckycli/core";
import { resolveActivationMcp } from "./Root.js";

const docs: McpServerConfig = { type: "local", command: ["node", "docs.js"] };
const github: McpServerConfig = { type: "local", command: ["node", "gh.js"] };

describe("resolveActivationMcp", () => {
  it("uses the explicit override when a config change provides one", () => {
    // The bug this guards: onMcpConfigChange must rebuild with the NEW config.
    // setMcpConfig is async, so the closure's `current` is still the old value.
    const current = { docs };
    const next = { docs, github };
    expect(resolveActivationMcp(next, current)).toBe(next);
  });

  it("honors an empty override (last server removed) over stale current state", () => {
    expect(resolveActivationMcp({}, { docs })).toEqual({});
  });

  it("falls back to current state when no override is given", () => {
    const current = { docs };
    expect(resolveActivationMcp(undefined, current)).toBe(current);
  });
});
