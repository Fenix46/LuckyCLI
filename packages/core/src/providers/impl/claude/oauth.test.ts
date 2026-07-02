import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claudeContextWindowForModel,
  claudeEffortLevelsForModel,
  normalizeClaudeEffort,
} from "./oauth.js";

describe("Claude OAuth context window", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses 1M context for Claude Code-capable Sonnet/Opus models", () => {
    expect(claudeContextWindowForModel("claude-sonnet-4-6")).toBe(1_000_000);
    expect(claudeContextWindowForModel("claude-sonnet-5")).toBe(1_000_000);
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

  it("returns Claude effort levels only for supported models", () => {
    expect(claudeEffortLevelsForModel("claude-sonnet-4-6")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(claudeEffortLevelsForModel("claude-sonnet-5")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(claudeEffortLevelsForModel("claude-haiku-4-5-20251001")).toEqual([]);
  });

  it("maps xhigh to max for opus and clamps unsupported max to high", () => {
    expect(normalizeClaudeEffort("claude-opus-4-8", "xhigh")).toBe("max");
    expect(normalizeClaudeEffort("claude-sonnet-4-6", "max")).toBe("high");
  });

  it("supports max/xhigh effort on Sonnet 5 (first Sonnet tier with it)", () => {
    expect(normalizeClaudeEffort("claude-sonnet-5", "max")).toBe("max");
    expect(normalizeClaudeEffort("claude-sonnet-5", "xhigh")).toBe("max");
  });
});
