import { stringWidth } from "../../vendor/ink-compat.js";

/**
 * Width-aware layout for markdown tables. A table is drawn as a bordered grid
 * when it fits the terminal: at its natural width when possible, otherwise
 * with columns shrunk proportionally and cell text wrapped inside them. When
 * even the narrowest readable columns don't fit (many columns, small
 * terminal), it falls back to a stacked "header: value" record per row, which
 * stays legible at any width instead of breaking into a mess of box-drawing.
 */
export type TableLayout =
  | {
      kind: "grid";
      /** Content width of each column (padding and borders excluded). */
      widths: number[];
      /** Header cells, each wrapped into lines. */
      header: string[][];
      /** Body rows → cells → wrapped lines. */
      rows: string[][][];
    }
  | { kind: "stacked"; headers: string[]; rows: string[][] };

/** A column never shrinks below this unless its content is narrower. */
const MIN_COLUMN = 4;
/** Long words count toward a column's minimum only up to this width. */
const MAX_WORD_MIN = 16;

/** Border overhead of a grid row: "│ " before each cell, " " after, final "│". */
export function gridOverhead(columns: number): number {
  return columns * 3 + 1;
}

/** Drop inline markdown markers so cells measure and wrap as plain text. */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
}

/** Greedy word wrap to `width` columns; words longer than a line are split. */
export function wrapCell(text: string, width: number): string[] {
  const max = Math.max(1, width);
  const lines: string[] = [];
  let line = "";
  let lineWidth = 0;
  const flush = () => {
    lines.push(line);
    line = "";
    lineWidth = 0;
  };
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const wordWidth = stringWidth(word);
    if (wordWidth > max) {
      if (line) flush();
      for (const char of Array.from(word)) {
        const charWidth = stringWidth(char);
        if (lineWidth + charWidth > max) flush();
        line += char;
        lineWidth += charWidth;
      }
      continue;
    }
    if (line && lineWidth + 1 + wordWidth > max) flush();
    line = line ? `${line} ${word}` : word;
    lineWidth = stringWidth(line);
  }
  if (line || lines.length === 0) lines.push(line);
  return lines;
}

function longestWord(text: string): number {
  return Math.max(0, ...text.split(/\s+/).map((word) => stringWidth(word)));
}

/** Fit `natural` column widths into `available` cells, or null if impossible. */
export function fitColumns(natural: number[], minimum: number[], available: number): number[] | null {
  const naturalTotal = natural.reduce((sum, w) => sum + w, 0);
  if (naturalTotal <= available) return natural;
  const minTotal = minimum.reduce((sum, w) => sum + w, 0);
  if (minTotal > available) return null;

  // Share the spare room out in proportion to how much each column wants.
  const spare = available - minTotal;
  const wants = natural.map((w, i) => w - minimum[i]!);
  const wantTotal = wants.reduce((sum, w) => sum + w, 0);
  const widths = minimum.map((w, i) => w + Math.floor((spare * wants[i]!) / wantTotal));
  let leftover = available - widths.reduce((sum, w) => sum + w, 0);
  while (leftover > 0) {
    let best = -1;
    for (let i = 0; i < widths.length; i++) {
      if (widths[i]! < natural[i]! && (best < 0 || natural[i]! - widths[i]! > natural[best]! - widths[best]!)) {
        best = i;
      }
    }
    if (best < 0) break;
    widths[best]! += 1;
    leftover -= 1;
  }
  return widths;
}

export function layoutTable(headers: string[], body: string[][], width: number): TableLayout {
  const columns = headers.length;
  const head = headers.map(stripInlineMarkdown);
  const rows = body.map((row) => head.map((_, c) => stripInlineMarkdown(row[c] ?? "")));
  const cells = [head, ...rows];

  const natural = head.map((_, c) => Math.max(1, ...cells.map((row) => stringWidth(row[c]!))));
  // A column's minimum fits its longest word (capped), so wrapping breaks
  // between words rather than through them whenever there is room.
  const minimum = head.map((_, c) => {
    const word = Math.max(...cells.map((row) => longestWord(row[c]!)));
    return Math.min(natural[c]!, Math.max(MIN_COLUMN, Math.min(MAX_WORD_MIN, word)));
  });
  const widths = fitColumns(natural, minimum, width - gridOverhead(columns));
  if (!widths) return { kind: "stacked", headers: head, rows };

  return {
    kind: "grid",
    widths,
    header: head.map((cell, c) => wrapCell(cell, widths[c]!)),
    rows: rows.map((row) => row.map((cell, c) => wrapCell(cell, widths[c]!))),
  };
}
