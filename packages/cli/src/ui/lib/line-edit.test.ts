import { describe, expect, it } from "vitest";
import { deleteWordLeft, wordLeft, wordRight } from "./line-edit.js";

describe("line-edit word primitives", () => {
  const text = "fix the  parser bug";

  it("wordLeft jumps to the start of the previous word", () => {
    expect(wordLeft(text, text.length)).toBe(16); // before "bug"
    expect(wordLeft(text, 16)).toBe(9); // before "parser"
    expect(wordLeft(text, 9)).toBe(4); // skips the double space
    expect(wordLeft(text, 4)).toBe(0);
    expect(wordLeft(text, 0)).toBe(0);
  });

  it("wordRight jumps past the end of the next word", () => {
    expect(wordRight(text, 0)).toBe(3); // after "fix"
    expect(wordRight(text, 3)).toBe(7); // after "the"
    expect(wordRight(text, 7)).toBe(15); // skips the double space, after "parser"
    expect(wordRight(text, text.length)).toBe(text.length);
  });

  it("deleteWordLeft removes the previous word and trailing gap", () => {
    expect(deleteWordLeft("fix the bug", 11)).toEqual({ text: "fix the ", offset: 8 });
    expect(deleteWordLeft("fix the ", 8)).toEqual({ text: "fix ", offset: 4 });
    expect(deleteWordLeft("word", 4)).toEqual({ text: "", offset: 0 });
    expect(deleteWordLeft("", 0)).toEqual({ text: "", offset: 0 });
  });

  it("handles newlines and tabs as separators", () => {
    expect(wordLeft("a\nbb", 4)).toBe(2);
    expect(wordRight("a\tbb cc", 1)).toBe(4);
  });

  it("clamps offsets outside the text", () => {
    expect(wordLeft("ab", 99)).toBe(0);
    expect(wordRight("ab", -1)).toBe(2);
  });
});
