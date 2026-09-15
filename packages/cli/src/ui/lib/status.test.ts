import { describe, expect, it } from "vitest";
import { totalUsageDetail } from "./status.js";

describe("totalUsageDetail", () => {
  it("formats cumulative input, output, and cache usage", () => {
    expect(
      totalUsageDetail({
        model: "test",
        tokenCounter: "provider",
        totalInputTokens: 1200,
        totalOutputTokens: 340,
        totalCacheReadTokens: 80,
        totalCacheWriteTokens: 10,
      }),
    ).toBe("1,200 in · 340 out · 80 cache read · 10 cache write");
  });

  it("stays hidden when cumulative usage is unavailable", () => {
    expect(totalUsageDetail({ model: "test", tokenCounter: "unavailable" })).toBeUndefined();
  });
});
