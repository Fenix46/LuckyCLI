import { describe, expect, it } from "vitest";
import { streamingTail } from "./streaming.js";

describe("streamingTail", () => {
  it("returns short text unchanged", () => {
    expect(streamingTail("hello\nworld")).toBe("hello\nworld");
  });

  it("caps to the last few lines by default so the preview fits the viewport", () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const tail = streamingTail(text);
    const lines = tail.split("\n");
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe("line 94");
    expect(lines.at(-1)).toBe("line 99");
  });

  it("honors an explicit max-lines budget", () => {
    const text = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const lines = streamingTail(text, 3).split("\n");
    expect(lines).toEqual(["line 17", "line 18", "line 19"]);
  });

  it("drops trailing blank lines so the box doesn't grow with padding", () => {
    expect(streamingTail("a\nb\n\n\n")).toBe("a\nb");
  });

  it("caps to the last 8000 chars on a line boundary", () => {
    const text = `${"x".repeat(10_000)}\ntail line`;
    const tail = streamingTail(text);
    expect(tail).toBe("tail line");
  });
});
