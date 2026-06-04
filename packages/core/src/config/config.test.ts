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

  describe("reasoning effort", () => {
    const creds: StoredConfig = {
      credentials: { "openai-oauth": { type: "openai-oauth", access: "a", refresh: "r", expires: 0 } },
    } as StoredConfig;

    it("defaults to medium for openai-oauth", () => {
      const r = resolveConfig({ provider: "openai-oauth" }, creds, {});
      expect(r.reasoningEffort).toBe("medium");
    });

    it("carries the stored effort for openai-oauth", () => {
      const r = resolveConfig(
        { provider: "openai-oauth" },
        { ...creds, providerSettings: { "openai-oauth": { reasoningEffort: "xhigh" } } },
        {},
      );
      expect(r.reasoningEffort).toBe("xhigh");
    });

    it("ignores effort for other providers", () => {
      const r = resolveConfig({ provider: "openai" }, { reasoningEffort: "high" }, {});
      expect(r.reasoningEffort).toBeUndefined();
    });

    it("carries stored effort for claude", () => {
      const r = resolveConfig(
        { provider: "claude" },
        { providerSettings: { claude: { reasoningEffort: "high" } } },
        {},
      );
      expect(r.reasoningEffort).toBe("high");
    });

    it("lets LUCKY_REASONING_EFFORT override", () => {
      const r = resolveConfig({ provider: "openai-oauth" }, creds, {
        LUCKY_REASONING_EFFORT: "low",
      });
      expect(r.reasoningEffort).toBe("low");
    });
  });

  describe("thinking toggle", () => {
    it("defaults to enabled for claude", () => {
      const r = resolveConfig({ provider: "claude" }, {}, {});
      expect(r.thinkingEnabled).toBe(true);
    });

    it("carries the stored thinking toggle for claude", () => {
      const r = resolveConfig(
        { provider: "claude" },
        { providerSettings: { claude: { thinkingEnabled: false } } },
        {},
      );
      expect(r.thinkingEnabled).toBe(false);
    });

    it("lets LUCKY_THINKING override for claude", () => {
      const r = resolveConfig({ provider: "claude" }, {
        providerSettings: { claude: { thinkingEnabled: false } },
      }, {
        LUCKY_THINKING: "on",
      });
      expect(r.thinkingEnabled).toBe(true);
    });
  });
});
