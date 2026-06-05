import { describe, expect, it } from "vitest";
import {
  countLines,
  expandPastedRefs,
  formatPastedRef,
  nextPasteId,
  pruneOrphanedPastes,
  shouldStashPaste,
  type PastedContents,
} from "./paste.js";

describe("shouldStashPaste", () => {
  it("ignores short single-line input", () => {
    expect(shouldStashPaste("hello world")).toBe(false);
  });

  it("stashes input longer than the char threshold", () => {
    expect(shouldStashPaste("x".repeat(1001))).toBe(true);
  });

  it("stashes input with more than two newlines", () => {
    expect(shouldStashPaste("a\nb\nc")).toBe(false); // exactly 2 newlines: inline
    expect(shouldStashPaste("a\nb\nc\nd")).toBe(true); // 3 newlines crosses it
  });

  it("keeps a two-line paste inline", () => {
    expect(shouldStashPaste("one\ntwo")).toBe(false);
  });
});

describe("formatPastedRef", () => {
  it("omits the line count for single-line content", () => {
    expect(formatPastedRef(1, 0)).toBe("[Pasted text #1]");
  });

  it("includes the line count otherwise", () => {
    expect(formatPastedRef(2, 42)).toBe("[Pasted text #2 +42 lines]");
  });
});

describe("countLines", () => {
  it("counts newlines, not lines", () => {
    expect(countLines("a\nb\nc")).toBe(2);
    expect(countLines("a\r\nb")).toBe(1);
    expect(countLines("")).toBe(0);
  });
});

describe("nextPasteId", () => {
  it("starts at 1 when empty", () => {
    expect(nextPasteId({})).toBe(1);
  });

  it("is one past the max existing id", () => {
    expect(nextPasteId({ 1: { id: 1, content: "a" }, 5: { id: 5, content: "b" } })).toBe(6);
  });
});

describe("expandPastedRefs", () => {
  const contents: PastedContents = {
    1: { id: 1, content: "BIG CONTENT ONE" },
    2: { id: 2, content: "second\nblock" },
  };

  it("splices stashed content back in", () => {
    const input = "see [Pasted text #1 +0 lines] and [Pasted text #2 +1 lines] done";
    expect(expandPastedRefs(input, contents)).toBe("see BIG CONTENT ONE and second\nblock done");
  });

  it("leaves unknown refs untouched", () => {
    expect(expandPastedRefs("[Pasted text #9]", contents)).toBe("[Pasted text #9]");
  });

  it("does not re-expand placeholder-like text inside stashed content", () => {
    const tricky: PastedContents = { 1: { id: 1, content: "[Pasted text #1]" } };
    // The stored content itself looks like a ref; it must be inserted as-is.
    expect(expandPastedRefs("[Pasted text #1]", tricky)).toBe("[Pasted text #1]");
  });
});

describe("pruneOrphanedPastes", () => {
  it("drops entries whose placeholder was deleted", () => {
    const contents: PastedContents = {
      1: { id: 1, content: "a" },
      2: { id: 2, content: "b" },
    };
    const pruned = pruneOrphanedPastes("only [Pasted text #2] remains", contents);
    expect(pruned).toEqual({ 2: { id: 2, content: "b" } });
  });
});
