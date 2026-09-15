import { describe, expect, it } from "vitest";
import { estimatedCostDetail, totalUsageDetail } from "./status.js";

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

describe("estimatedCostDetail", () => {
  it("formats the configured cumulative token cost", () => {
    expect(
      estimatedCostDetail(
        { model: "test", tokenCounter: "provider", totalInputTokens: 1_000_000, totalOutputTokens: 500_000 },
        { currency: "USD", inputPerMillion: 2, outputPerMillion: 4 },
      ),
    ).toBe("4.000000 USD");
  });

  it("stays hidden until both cumulative totals are available", () => {
    expect(
      estimatedCostDetail({ model: "test", tokenCounter: "provider", totalInputTokens: 10 }, { inputPerMillion: 1, outputPerMillion: 1 }),
    ).toBeUndefined();
  });
});
