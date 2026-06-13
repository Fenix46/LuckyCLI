import { describe, it, expect } from "vitest";
import { findStableSplit } from "./stream-split.js";

describe("findStableSplit", () => {
  it("returns 0 for a single growing paragraph (no boundary yet)", () => {
    expect(findStableSplit("hello wor")).toBe(0);
    expect(findStableSplit("hello world this is one block")).toBe(0);
  });

  it("splits after a blank line separating two paragraphs", () => {
    const text = "first para\n\nsecond para being typed";
    const split = findStableSplit(text);
    expect(text.slice(0, split)).toBe("first para\n\n");
    expect(text.slice(split)).toBe("second para being typed");
  });

  it("uses the LAST blank line as the boundary", () => {
    const text = "a\n\nb\n\nc growing";
    const split = findStableSplit(text);
    expect(text.slice(0, split)).toBe("a\n\nb\n\n");
    expect(text.slice(split)).toBe("c growing");
  });

  it("never splits inside an unclosed code fence", () => {
    const text = "intro\n\n```ts\nconst x = 1\n\nconst y = 2";
    const split = findStableSplit(text);
    // The blank line inside the fence must NOT be a boundary.
    expect(text.slice(0, split)).toBe("intro\n\n");
    expect(text.slice(split)).toBe("```ts\nconst x = 1\n\nconst y = 2");
  });

  it("allows a boundary after a closed code fence", () => {
    const text = "```ts\nconst x = 1\n```\n\nnext para";
    const split = findStableSplit(text);
    expect(text.slice(0, split)).toBe("```ts\nconst x = 1\n```\n\n");
    expect(text.slice(split)).toBe("next para");
  });

  it("is monotonic: the boundary only grows as text is appended", () => {
    const steps = [
      "para one",
      "para one\n",
      "para one\n\n",
      "para one\n\npara two start",
      "para one\n\npara two start\n\n",
      "para one\n\npara two start\n\nthree",
    ];
    let last = 0;
    for (const step of steps) {
      const split = findStableSplit(step);
      expect(split).toBeGreaterThanOrEqual(last);
      last = split;
    }
  });
});
