import { describe, expect, it } from "vitest";
import { CONTEXT_WARNING_RATIO, contextWarning } from "./context-warning.js";

describe("contextWarning", () => {
  it("stays silent without a usable size", () => {
    expect(contextWarning(null)).toBeNull();
    expect(contextWarning(undefined)).toBeNull();
    expect(contextWarning({ model: "m", tokenCounter: "unavailable" })).toBeNull();
  });

  it("stays silent below the threshold", () => {
    expect(contextWarning({ model: "m", tokenCounter: "estimate", ratio: 0.4 })).toBeNull();
    expect(
      contextWarning({ model: "m", tokenCounter: "estimate", usedPercentage: 79 }),
    ).toBeNull();
  });

  it("warns at the threshold and includes the percentage", () => {
    const message = contextWarning({
      model: "m",
      tokenCounter: "provider",
      ratio: CONTEXT_WARNING_RATIO,
    });
    expect(message).toMatch(/80% full/);
    expect(message).toContain("/compact");
  });

  it("accepts a usedPercentage when ratio is absent", () => {
    expect(
      contextWarning({ model: "m", tokenCounter: "estimate", usedPercentage: 95 }),
    ).toMatch(/95% full/);
  });
});
