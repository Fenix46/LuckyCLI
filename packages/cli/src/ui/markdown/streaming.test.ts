import { describe, expect, it } from "vitest";
import { streamingTail } from "./streaming.js";

describe("streamingTail", () => {
  it("returns short text unchanged", () => {
    expect(streamingTail("hello\nworld")).toBe("hello\nworld");
  });

  it("caps to the last 40 lines", () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const tail = streamingTail(text);
    const lines = tail.split("\n");
    expect(lines).toHaveLength(40);
    expect(lines[0]).toBe("line 60");
    expect(lines.at(-1)).toBe("line 99");
  });

  it("caps to the last 8000 chars on a line boundary", () => {
    const text = `${"x".repeat(10_000)}\ntail line`;
    const tail = streamingTail(text);
    expect(tail.length).toBeLessThanOrEqual(8_000);
    // the partial first line is dropped at the newline boundary
    expect(tail).toBe("tail line");
  });
});
