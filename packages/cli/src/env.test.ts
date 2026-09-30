import { describe, expect, it } from "vitest";
import "./env.js";

describe("env bootstrap", () => {
  it("drops only the punycode DEP0040 deprecation warning", async () => {
    const seen: string[] = [];
    const listener = (warning: Error & { code?: string }) => seen.push(warning.code ?? warning.message);
    process.on("warning", listener);
    try {
      process.emitWarning("punycode is deprecated", "DeprecationWarning", "DEP0040");
      process.emitWarning("punycode is deprecated", { type: "DeprecationWarning", code: "DEP0040" });
      process.emitWarning("something else", "DeprecationWarning", "DEP9999");
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off("warning", listener);
    }
    expect(seen).toEqual(["DEP9999"]);
  });
});
