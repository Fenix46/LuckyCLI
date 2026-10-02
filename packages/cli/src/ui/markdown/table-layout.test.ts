import { describe, expect, it } from "vitest";
import { fitColumns, gridOverhead, layoutTable, stripInlineMarkdown, wrapCell } from "./table-layout.js";

const headers = ["Provider", "Model", "Notes"];
const rows = [
  ["Claude", "claude-opus-5-5", "Great for refactoring large codebases and long reasoning"],
  ["OpenAI", "gpt-5.1-codex", "Fast"],
];

describe("wrapCell", () => {
  it("wraps between words", () => {
    expect(wrapCell("one two three four", 9)).toEqual(["one two", "three", "four"]);
  });

  it("splits a word longer than the line", () => {
    expect(wrapCell("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("keeps an empty cell as one blank line", () => {
    expect(wrapCell("", 5)).toEqual([""]);
  });
});

describe("stripInlineMarkdown", () => {
  it("drops bold, code and link markers", () => {
    expect(stripInlineMarkdown("**bold** `code` [docs](https://x.y)")).toBe("bold code docs");
  });
});

describe("fitColumns", () => {
  it("keeps natural widths when they fit", () => {
    expect(fitColumns([5, 10], [4, 4], 20)).toEqual([5, 10]);
  });

  it("shrinks columns to exactly the available room", () => {
    const widths = fitColumns([10, 40], [6, 8], 30)!;
    expect(widths.reduce((a, b) => a + b, 0)).toBe(30);
    expect(widths[0]).toBeGreaterThanOrEqual(6);
    expect(widths[1]).toBeGreaterThanOrEqual(8);
  });

  it("gives up when even the minimums do not fit", () => {
    expect(fitColumns([10, 40], [6, 8], 10)).toBeNull();
  });
});

describe("layoutTable", () => {
  it("uses natural widths on a wide terminal", () => {
    const layout = layoutTable(headers, rows, 120);
    expect(layout.kind).toBe("grid");
    if (layout.kind !== "grid") return;
    expect(layout.rows[0]![2]).toHaveLength(1);
  });

  it("wraps long cells to stay inside a narrow terminal", () => {
    const width = 60;
    const layout = layoutTable(headers, rows, width);
    expect(layout.kind).toBe("grid");
    if (layout.kind !== "grid") return;
    expect(layout.widths.reduce((a, b) => a + b, 0) + gridOverhead(3)).toBeLessThanOrEqual(width);
    expect(layout.rows[0]![2]!.length).toBeGreaterThan(1);
    // Short words never get split when there is room for them.
    expect(layout.rows[0]![1]).toEqual(["claude-opus-5-5"]);
  });

  it("stacks rows as records when the columns cannot fit", () => {
    const layout = layoutTable(headers, rows, 24);
    expect(layout).toEqual({ kind: "stacked", headers, rows });
  });

  it("pads short rows with empty cells", () => {
    const layout = layoutTable(["a", "b"], [["1"]], 80);
    expect(layout.kind === "grid" && layout.rows[0]).toEqual([["1"], [""]]);
  });
});
