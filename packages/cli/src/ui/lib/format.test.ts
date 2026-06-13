import { describe, it, expect } from "vitest";
import { formatElapsed } from "./format.js";

describe("formatElapsed", () => {
  it("stays in plain seconds under a minute", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(1)).toBe("1s");
    expect(formatElapsed(42)).toBe("42s");
    expect(formatElapsed(59)).toBe("59s");
  });

  it("rolls over to minutes at 60s with zero-padded seconds", () => {
    expect(formatElapsed(60)).toBe("1m 00s");
    expect(formatElapsed(61)).toBe("1m 01s");
    expect(formatElapsed(125)).toBe("2m 05s");
    expect(formatElapsed(3599)).toBe("59m 59s");
  });

  it("rolls over to hours with zero-padded minutes and seconds", () => {
    expect(formatElapsed(3600)).toBe("1h 00m 00s");
    expect(formatElapsed(3661)).toBe("1h 01m 01s");
    expect(formatElapsed(7325)).toBe("2h 02m 05s");
  });

  it("floors fractional seconds and clamps negatives", () => {
    expect(formatElapsed(42.9)).toBe("42s");
    expect(formatElapsed(-5)).toBe("0s");
  });
});
