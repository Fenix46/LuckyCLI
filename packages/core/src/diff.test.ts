import { describe, expect, it } from "vitest";
import { diffLines, fileDiff } from "./diff.js";

function render(hunkLines: { type: string; text: string }[]): string[] {
  return hunkLines.map((l) => `${l.type === "add" ? "+" : l.type === "del" ? "-" : " "}${l.text}`);
}

describe("diffLines", () => {
  it("returns no hunks for identical texts", () => {
    const d = diffLines("a\nb\nc\n", "a\nb\nc\n");
    expect(d).toEqual({ additions: 0, deletions: 0, hunks: [] });
  });

  it("diffs a single replaced line with context and line numbers", () => {
    const oldText = "one\ntwo\nthree\nfour\nfive\nsix\nseven\n";
    const newText = "one\ntwo\nthree\nFOUR\nfive\nsix\nseven\n";
    const d = diffLines(oldText, newText);
    expect(d.additions).toBe(1);
    expect(d.deletions).toBe(1);
    expect(d.hunks).toHaveLength(1);
    const hunk = d.hunks[0]!;
    expect(render(hunk.lines)).toEqual([
      " one",
      " two",
      " three",
      "-four",
      "+FOUR",
      " five",
      " six",
      " seven",
    ]);
    const del = hunk.lines.find((l) => l.type === "del")!;
    const add = hunk.lines.find((l) => l.type === "add")!;
    expect(del.oldLine).toBe(4);
    expect(del.newLine).toBeUndefined();
    expect(add.newLine).toBe(4);
    expect(add.oldLine).toBeUndefined();
  });

  it("handles pure additions and deletions", () => {
    const add = diffLines("a\nc\n", "a\nb\nc\n");
    expect(add.additions).toBe(1);
    expect(add.deletions).toBe(0);

    const del = diffLines("a\nb\nc\n", "a\nc\n");
    expect(del.additions).toBe(0);
    expect(del.deletions).toBe(1);
    expect(del.hunks[0]!.lines.find((l) => l.type === "del")!.text).toBe("b");
  });

  it("splits distant changes into separate hunks", () => {
    const oldLines = Array.from({ length: 40 }, (_, i) => `line${i + 1}`);
    const newLines = [...oldLines];
    newLines[2] = "CHANGED-A";
    newLines[35] = "CHANGED-B";
    const d = diffLines(`${oldLines.join("\n")}\n`, `${newLines.join("\n")}\n`);
    expect(d.hunks).toHaveLength(2);
    expect(d.hunks[0]!.lines.some((l) => l.text === "CHANGED-A")).toBe(true);
    expect(d.hunks[1]!.lines.some((l) => l.text === "CHANGED-B")).toBe(true);
    // Second hunk's numbering reflects its position in the file.
    expect(d.hunks[1]!.oldStart).toBeGreaterThan(30);
  });

  it("merges changes whose context regions touch", () => {
    const oldLines = ["a", "b", "c", "d", "e", "f", "g"];
    const newLines = ["a", "B", "c", "d", "E", "f", "g"];
    const d = diffLines(`${oldLines.join("\n")}\n`, `${newLines.join("\n")}\n`);
    expect(d.hunks).toHaveLength(1);
    expect(d.additions).toBe(2);
    expect(d.deletions).toBe(2);
  });

  it("diffs creation from empty text", () => {
    const d = diffLines("", "hello\nworld\n");
    expect(d.additions).toBe(2);
    expect(d.deletions).toBe(0);
    expect(render(d.hunks[0]!.lines)).toEqual(["+hello", "+world"]);
  });

  it("survives very large divergent inputs via the coarse fallback", () => {
    const oldText = Array.from({ length: 4000 }, (_, i) => `old${i}`).join("\n");
    const newText = Array.from({ length: 4000 }, (_, i) => `new${i}`).join("\n");
    const d = diffLines(oldText, newText);
    expect(d.additions).toBe(4000);
    expect(d.deletions).toBe(4000);
    expect(d.hunks.length).toBeGreaterThan(0);
  });

  it("keeps a localized edit in a large file exact (prefix/suffix trim)", () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `line${i}`);
    const changed = [...lines];
    changed[2500] = "CHANGED";
    const d = diffLines(lines.join("\n"), changed.join("\n"));
    expect(d.additions).toBe(1);
    expect(d.deletions).toBe(1);
    expect(d.hunks).toHaveLength(1);
  });
});

describe("fileDiff", () => {
  it("carries path and the created flag", () => {
    const d = fileDiff("src/new.ts", "", "a\n", { created: true });
    expect(d.path).toBe("src/new.ts");
    expect(d.created).toBe(true);
    expect(d.additions).toBe(1);
  });
});
