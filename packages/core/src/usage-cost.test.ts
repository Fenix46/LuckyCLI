import { describe, expect, it } from "vitest";
import { estimateTokenCost } from "./usage-cost.js";

describe("estimateTokenCost", () => {
  it("calculates token components per million", () => {
    expect(estimateTokenCost(
      { inputTokens: 2_000_000, outputTokens: 500_000, cacheReadTokens: 100_000, cacheWriteTokens: 50_000 },
      { inputPerMillion: 1, outputPerMillion: 4, cacheReadPerMillion: 0.2, cacheWritePerMillion: 0.5 },
    )).toEqual({ input: 2, output: 2, cacheRead: 0.02, cacheWrite: 0.025, total: 4.045 });
  });

  it("rejects invalid token counts and rates", () => {
    expect(() => estimateTokenCost({ inputTokens: -1, outputTokens: 0 }, { inputPerMillion: 1, outputPerMillion: 1 })).toThrow(/Token counts/);
    expect(() => estimateTokenCost({ inputTokens: 0, outputTokens: 0 }, { inputPerMillion: -1, outputPerMillion: 1 })).toThrow(/cost rates/);
  });
});
