import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claudeContextWindowForModel,
  claudeEffortLevelsForModel,
  claudeModelAcceptsSampling,
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
    expect(claudeEffortLevelsForModel("claude-sonnet-4-6")).toEqual(["low", "medium", "high"]);
    expect(claudeEffortLevelsForModel("claude-opus-4-6")).toEqual(["low", "medium", "high", "max"]);
    expect(claudeEffortLevelsForModel("claude-sonnet-5")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(claudeEffortLevelsForModel("claude-haiku-4-5-20251001")).toEqual([]);
  });

  it("keeps xhigh where supported and clamps unsupported levels to high", () => {
    expect(normalizeClaudeEffort("claude-opus-4-8", "xhigh")).toBe("xhigh");
    expect(normalizeClaudeEffort("claude-opus-4-6", "xhigh")).toBe("high");
    expect(normalizeClaudeEffort("claude-opus-4-6", "max")).toBe("max");
    expect(normalizeClaudeEffort("claude-sonnet-4-6", "max")).toBe("high");
  });

  it("supports max/xhigh effort on Sonnet 5 (first Sonnet tier with it)", () => {
    expect(normalizeClaudeEffort("claude-sonnet-5", "max")).toBe("max");
    expect(normalizeClaudeEffort("claude-sonnet-5", "xhigh")).toBe("xhigh");
  });

  // These predicates are substring matches, so a model rename silently drops
  // capabilities rather than failing loudly — pin them for every catalog model.
  it.each([
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "claude-fable-5-1",
    "claude-sonnet-5",
    "claude-opus-5",
    "claude-fable-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
  ])("gives %s the full capability set", (model) => {
    expect(claudeContextWindowForModel(model)).toBe(1_000_000);
    expect(claudeEffortLevelsForModel(model)).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(normalizeClaudeEffort(model, "xhigh")).toBe("xhigh");
    expect(claudeModelAcceptsSampling(model)).toBe(false);
  });

  it("keeps sampling and 1M context on the 4.6 models", () => {
    expect(claudeContextWindowForModel("claude-opus-4-6")).toBe(1_000_000);
    expect(claudeContextWindowForModel("claude-sonnet-4-6")).toBe(1_000_000);
    expect(claudeModelAcceptsSampling("claude-sonnet-4-6")).toBe(true);
    expect(claudeModelAcceptsSampling("claude-haiku-4-5-20251001")).toBe(true);
  });
});
