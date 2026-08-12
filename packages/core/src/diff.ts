/**
 * Line-based diff engine for file-change visualization.
 *
 * Myers' O((N+M)·D) greedy algorithm over lines, with a common prefix/suffix
 * trim so typical localized edits stay tiny, and a coarse whole-block fallback
 * for pathological inputs (huge files or extremely divergent contents) where
 * an exact diff would not be worth its memory. The output is structured hunks
 * with old/new line numbers — renderers decide how to draw them.
 */

export interface DiffLine {
  type: "context" | "add" | "del";
  text: string;
  /** 1-based line number in the old file (absent for additions). */
  oldLine?: number;
  /** 1-based line number in the new file (absent for deletions). */
  newLine?: number;
}

export interface DiffHunk {
  /** 1-based first old line covered by the hunk. */
  oldStart: number;
  oldLines: number;
  /** 1-based first new line covered by the hunk. */
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  /** True when the file did not exist before (pure creation). */
  created?: boolean;
  /**
   * The complete file contents before and after the change.
   *
   * Hunks alone cannot be reassembled into a file: they omit the unchanged
   * regions between them. Consumers that must hand a real before/after pair to
   * something else — the ACP `diff` content block, which editors render as a
   * side-by-side view of the file — need these. Terminal renderers that draw
   * hunks directly can ignore them.
   *
   * Absent when the producer never had the full text (a preview built from a
   * snippet, an older serialized diff).
   */
  oldText?: string;
  newText?: string;
}

/** Context lines kept around each change when grouping into hunks. */
const DEFAULT_CONTEXT = 3;
/** Beyond this many middle lines (old+new), fall back to a coarse diff. */
const EXACT_DIFF_LINE_BUDGET = 3000;
/** Myers edit-distance cap; beyond it the inputs are too divergent to bother. */
const D_LIMIT = 600;

/** Diff two texts line-by-line into context-grouped hunks. */
export function diffLines(
  oldText: string,
  newText: string,
  context = DEFAULT_CONTEXT,
): { additions: number; deletions: number; hunks: DiffHunk[] } {
  if (oldText === newText) return { additions: 0, deletions: 0, hunks: [] };

  const a = splitLines(oldText);
  const b = splitLines(newText);

  // Trim the common prefix/suffix: edits are usually local, and this is what
  // keeps Myers cheap on big files.
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }

  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);

  const ops =
    midA.length + midB.length <= EXACT_DIFF_LINE_BUDGET
      ? myersOps(midA, midB) ?? coarseOps(midA, midB)
      : coarseOps(midA, midB);

  return buildHunks(a, b, prefix, ops, context);
}

/**
 * Convenience wrapper carrying the path, the creation flag, and the full
 * before/after text (see {@link FileDiff.oldText} — hunks alone cannot be
 * reassembled into a file).
 */
export function fileDiff(
  path: string,
  oldText: string,
  newText: string,
  opts: { created?: boolean; context?: number } = {},
): FileDiff {
  const { additions, deletions, hunks } = diffLines(oldText, newText, opts.context);
  return {
    path,
    additions,
    deletions,
    hunks,
    ...(opts.created ? { created: true } : {}),
    oldText,
    newText,
  };
}

type Op = "eq" | "del" | "add";

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  // A trailing newline produces a final empty element that isn't a real line.
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Whole-block replacement: every old line deleted, every new line added. */
function coarseOps(a: string[], b: string[]): Op[] {
  return [...a.map(() => "del" as const), ...b.map(() => "add" as const)];
}

/**
 * Classic Myers greedy diff. Returns the op sequence over (a, b), or
 * undefined when the edit distance exceeds D_LIMIT (caller falls back).
 */
function myersOps(a: string[], b: string[]): Op[] | undefined {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map(() => "add" as const);
  if (m === 0) return a.map(() => "del" as const);

  const max = Math.min(n + m, D_LIMIT);
  const offset = max;
  const v = new Int32Array(2 * max + 1);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      if (k < -max || k > max) continue;
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) {
        x = v[offset + k + 1]!;
      } else {
        x = v[offset + k - 1]! + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        return backtrack(a, b, trace, d);
      }
    }
  }
  return undefined;
}

function backtrack(a: string[], b: string[], trace: Int32Array[], dEnd: number): Op[] {
  const n = a.length;
  const m = b.length;
  const offset = trace.length > 0 ? (trace[0]!.length - 1) / 2 : 0;
  const ops: Op[] = [];
  let x = n;
  let y = m;

  for (let d = dEnd; d > 0; d--) {
    const vPrev = trace[d]!;
    const k = x - y;
    const fromDown =
      k === -d || (k !== d && vPrev[offset + k - 1]! < vPrev[offset + k + 1]!);
    const prevK = fromDown ? k + 1 : k - 1;
    const prevX = vPrev[offset + prevK]!;
    const prevY = prevX - prevK;

    // Snake: equal lines walked after the edit.
    while (x > (fromDown ? prevX : prevX + 1) || y > (fromDown ? prevY + 1 : prevY)) {
      ops.push("eq");
      x--;
      y--;
    }
    if (fromDown) {
      ops.push("add");
      y--;
    } else {
      ops.push("del");
      x--;
    }
  }
  // Leading snake before the first edit.
  while (x > 0 && y > 0) {
    ops.push("eq");
    x--;
    y--;
  }
  while (x > 0) {
    ops.push("del");
    x--;
  }
  while (y > 0) {
    ops.push("add");
    y--;
  }
  return ops.reverse();
}

/**
 * Walk the full files (prefix + diffed middle + suffix) and group changed
 * lines into hunks with `context` unchanged lines around them; hunks whose
 * context regions touch are merged.
 */
function buildHunks(
  a: string[],
  b: string[],
  prefix: number,
  midOps: Op[],
  context: number,
): { additions: number; deletions: number; hunks: DiffHunk[] } {
  // Expand to a full op list over both files.
  const ops: Op[] = [
    ...Array.from({ length: prefix }, () => "eq" as const),
    ...midOps,
  ];
  const consumedA = ops.filter((op) => op !== "add").length;
  for (let i = consumedA; i < a.length; i++) ops.push("eq");

  interface Walked extends DiffLine {}
  const walked: Walked[] = [];
  let oldLine = 0;
  let newLine = 0;
  let additions = 0;
  let deletions = 0;
  for (const op of ops) {
    if (op === "eq") {
      oldLine++;
      newLine++;
      walked.push({ type: "context", text: a[oldLine - 1] ?? "", oldLine, newLine });
    } else if (op === "del") {
      oldLine++;
      deletions++;
      walked.push({ type: "del", text: a[oldLine - 1] ?? "", oldLine });
    } else {
      newLine++;
      additions++;
      walked.push({ type: "add", text: b[newLine - 1] ?? "", newLine });
    }
  }

  // Group into hunks: keep `context` lines around each run of changes.
  const hunks: DiffHunk[] = [];
  let i = 0;
  while (i < walked.length) {
    if (walked[i]!.type === "context") {
      i++;
      continue;
    }
    // Found a change; open the hunk `context` lines back.
    const start = Math.max(0, i - context);
    let end = i;
    let lastChange = i;
    while (end < walked.length && end - lastChange <= context * 2) {
      if (walked[end]!.type !== "context") lastChange = end;
      end++;
    }
    end = Math.min(walked.length, lastChange + context + 1);

    const lines = walked.slice(start, end);
    const firstOld = lines.find((l) => l.oldLine !== undefined)?.oldLine;
    const firstNew = lines.find((l) => l.newLine !== undefined)?.newLine;
    hunks.push({
      oldStart: firstOld ?? 1,
      oldLines: lines.filter((l) => l.type !== "add").length,
      newStart: firstNew ?? 1,
      newLines: lines.filter((l) => l.type !== "del").length,
      lines,
    });
    i = end;
  }

  return { additions, deletions, hunks };
}
