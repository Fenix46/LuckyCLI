import { afterEach, describe, expect, it, vi } from "vitest";
import { claudeContextWindowForModel } from "./oauth.js";

describe("Claude OAuth context window", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses 1M context for Claude Code-capable Sonnet/Opus models", () => {
    expect(claudeContextWindowForModel("claude-sonnet-4-6")).toBe(1_000_000);
    expect(claudeContextWindowForModel("claude-opus-4-8")).toBe(1_000_000);
  });

  it("falls back to 200k when 1M context is disabled", () => {
    vi.stubEnv("CLAUDE_CODE_DISABLE_1M_CONTEXT", "1");
    expect(claudeContextWindowForModel("claude-sonnet-4-6")).toBe(200_000);
  });

  it("honors explicit max context override", () => {
    vi.stubEnv("CLAUDE_CODE_MAX_CONTEXT_TOKENS", "123456");
    expect(claudeContextWindowForModel("claude-sonnet-4-6")).toBe(123_456);
  });
});
