import { describe, expect, it } from "vitest";
import { contextFooter, estimatedCostDetail, formatUsageFooter, totalUsageDetail } from "./status.js";

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

describe("formatUsageFooter", () => {
  it("shows session tokens, plus the cost when rates are configured", () => {
    expect(formatUsageFooter({ inputTokens: 0, outputTokens: 0 })).toBe("");
    expect(formatUsageFooter({ inputTokens: 15_400, outputTokens: 2_100 })).toBe("15k in · 2.1k out");
    expect(
      formatUsageFooter({ inputTokens: 1_000_000, outputTokens: 100_000 }, { currency: "USD", inputPerMillion: 3, outputPerMillion: 15 }),
    ).toBe("1.0M in · 100k out · ≈4.50 USD");
    expect(
      formatUsageFooter({ inputTokens: 10_000, outputTokens: 1_000 }, { inputPerMillion: 3, outputPerMillion: 15 }),
    ).toBe("10k in · 1.0k out · ≈0.0450");
  });

  it("keeps cached input apart from fresh input", () => {
    // Claude-style: input excludes the cache.
    expect(formatUsageFooter({ inputTokens: 2_000, outputTokens: 500, cacheReadTokens: 380_000 })).toBe(
      "2.0k in · 380k cached · 500 out",
    );
    // OpenAI-style: input already contains the cached tokens.
    expect(formatUsageFooter({ inputTokens: 382_000, outputTokens: 500, cacheReadTokens: 380_000 }, undefined, true)).toBe(
      "2.0k in · 380k cached · 500 out",
    );
  });
});

describe("contextFooter", () => {
  it("reports the fill level when the usable window is known", () => {
    expect(
      contextFooter({ model: "m", tokenCounter: "provider", usedTokens: 43_200, usableTokens: 180_000, usedPercentage: 24 }),
    ).toEqual({ percent: 24, label: "24%" });
  });

  it("falls back to raw usage or a placeholder", () => {
    expect(contextFooter(null)).toEqual({ label: "syncing…" });
    expect(contextFooter({ model: "m", tokenCounter: "provider", usedTokens: 9_000 })).toEqual({ label: "9.0k used" });
  });
});
