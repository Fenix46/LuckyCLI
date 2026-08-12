import { describe, expect, it } from "vitest";
import type { ContextStatus } from "@luckycli/core";
import { CONTEXT_META_KEY, USAGE_META_KEY, contextMeta, hasTokenCounts } from "./meta.js";

const base: ContextStatus = { model: "claude-sonnet-5", tokenCounter: "provider" };

describe("_meta keys", () => {
  it("namespaces both keys under dev.luckycli", () => {
    // These are a published contract for custom clients; renaming one is a
    // breaking change, so pin them.
    expect(USAGE_META_KEY).toBe("dev.luckycli/usage");
    expect(CONTEXT_META_KEY).toBe("dev.luckycli/context");
  });
});

describe("hasTokenCounts", () => {
  it("is false for a reading that says nothing about consumption", () => {
    expect(hasTokenCounts({ model: "m", tokenCounter: "unavailable" })).toBe(false);
  });

  it("is true once there is a used count or a window to show", () => {
    expect(hasTokenCounts({ ...base, usedTokens: 10 })).toBe(true);
    expect(hasTokenCounts({ ...base, contextWindow: 200_000 })).toBe(true);
  });

  it("treats a zero used count as a real reading", () => {
    expect(hasTokenCounts({ ...base, usedTokens: 0 })).toBe(true);
  });
});

describe("contextMeta", () => {
  it("publishes the committed subset and drops absent fields", () => {
    const meta = contextMeta({
      ...base,
      contextWindow: 200_000,
      usedTokens: 20_000,
      usableTokens: 180_000,
      usedPercentage: 11.4,
      totalCacheReadTokens: 500,
    });

    expect(meta).toEqual({
      model: "claude-sonnet-5",
      contextWindow: 200_000,
      usedTokens: 20_000,
      usableTokens: 180_000,
      usedPercentage: 11, // rounded for display
      cacheReadTokens: 500,
      tokenCounter: "provider",
    });
  });

  it("never leaks the engine's internal bookkeeping fields", () => {
    const meta = contextMeta({
      ...base,
      usedTokens: 1,
      ratio: 0.5,
      source: "countTokens",
      maxInputTokens: 100,
      currentInputTokens: 7,
    } as ContextStatus);

    for (const key of ["ratio", "source", "maxInputTokens", "currentInputTokens"]) {
      expect(meta).not.toHaveProperty(key);
    }
  });

  it("always carries the model and how the numbers were counted", () => {
    const meta = contextMeta({ model: "m", tokenCounter: "unavailable" });
    expect(meta).toEqual({ model: "m", tokenCounter: "unavailable" });
  });
});
