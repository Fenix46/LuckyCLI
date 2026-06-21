import { stringWidth } from "../../vendor/ink/stringWidth.js";

export interface Block {
  type: "paragraph" | "code" | "list" | "header" | "table";
  text: string;
  codeLines?: string[];
  language?: string;
  level?: number;
  /** Column width in cells for each column (used by the table renderer). */
  colWidths?: number[];
  /** Parsed rows of the table. row[0] is the header, row[1] is the separator marker. */
  rows?: string[][];
}

/** Split assistant text into renderable blocks (paragraphs, code, headers, lists, tables). */
export function parseMessageIntoBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let currentCodeBlock: { language: string; lines: string[] } | null = null;
  let prevEmpty = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (line.trim().startsWith("```")) {
      if (currentCodeBlock) {
        blocks.push({
          type: "code",
          text: "",
          codeLines: currentCodeBlock.lines,
          language: currentCodeBlock.language,
        });
        currentCodeBlock = null;
      } else {
        const lang = line.trim().slice(3).trim();
        currentCodeBlock = { language: lang || "code", lines: [] };
      }
      continue;
    }

    if (currentCodeBlock) {
      currentCodeBlock.lines.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      if (prevEmpty) continue;
      blocks.push({ type: "paragraph", text: "" });
      prevEmpty = true;
      continue;
    }
    prevEmpty = false;

    // Check for table: a pipe-delimited row followed (possibly with gaps) by a separator line
    if (isTableRow(trimmed)) {
      const tableResult = tryParseTable(lines, i);
      if (tableResult) {
        i = tableResult.endIndex;
        blocks.push({
          type: "table",
          text: "",
          colWidths: tableResult.colWidths,
          rows: tableResult.rows,
        });
        continue;
      }
    }

    const headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      blocks.push({
        type: "header",
        text: headerMatch[2] ?? "",
        level: headerMatch[1]?.length ?? 1,
      });
      continue;
    }

    const listMatch = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/);
    if (listMatch) {
      blocks.push({
        type: "list",
        text: line,
      });
      continue;
    }

    blocks.push({
      type: "paragraph",
      text: line,
    });
  }

  if (currentCodeBlock) {
    blocks.push({
      type: "code",
      text: "",
      codeLines: currentCodeBlock.lines,
      language: currentCodeBlock.language,
    });
  }

  return blocks;
}

/**
 * Check if a trimmed line looks like a table cell row (starts/ends with | or
 * has at least one | with surrounding content).
 */
function isTableRow(line: string): boolean {
  return /^\|?[\s\S]*\|/.test(line);
}

/**
 * Try to parse a markdown table starting at `lines[startIdx]`.
 * Returns parsed data and the index of the last table line (exclusive),
 * or null if this doesn't look like a table (e.g. incomplete during streaming).
 */
function tryParseTable(
  lines: string[],
  startIdx: number,
): { rows: string[][]; colWidths: number[]; endIndex: number } | null {
  const MAX_LINES = 200;
  const MIN_BODY_ROWS = 0; // allow tables with only header+separator

  // Scan forward from startIdx to find a separator line.
  // We look ahead up to MAX_LINES lines.
  let sepIdx = -1;
  for (let j = startIdx + 1; j < Math.min(lines.length, startIdx + MAX_LINES + 1); j++) {
    const t = lines[j]!.trim();
    if (t === "") break; // blank line before separator = not a table
    if (isSeparator(t)) {
      sepIdx = j;
      break;
    }
    // If we hit a line that doesn't look like a row at all, abandon
    if (!isTableRow(t)) break;
  }

  if (sepIdx === -1) {
    // No separator found yet — could be streaming.
    // Don't parse as table yet; the streaming tail will grow.
    // But if we see at least the header + 1 body row with a pipe,
    // try to render as partial table using the header as structure.
    // This handles the case where the separator hasn't fully arrived.
    return null;
  }

  // We have header at startIdx and separator at sepIdx.
  // Parse rows from startIdx through the next blank line or non-table line.
  const rows: string[][] = [];
  let endIndex = sepIdx + 1;

  // Parse header row
  rows.push(parseTableRow(lines[startIdx]!));

  // Parse separator row
  rows.push(parseTableRow(lines[sepIdx]!));

  // Parse body rows
  for (let j = sepIdx + 1; j < lines.length; j++) {
    const t = lines[j]!.trim();
    if (t === "") {
      endIndex = j;
      break;
    }
    if (!isTableRow(t)) {
      endIndex = j;
      break;
    }
    rows.push(parseTableRow(lines[j]!));
    endIndex = j + 1;
  }

  // Compute column widths from all rows (header + separator + body)
  const colWidths = computeColWidths(rows);

  return { rows, colWidths, endIndex };
}

/** Check if a line is a markdown table separator (|---|---| etc). */
function isSeparator(line: string): boolean {
  // Must contain at least one pipe
  if (!line.includes("|")) return false;
  // Every non-empty segment between pipes must be all dashes/colons/spaces
  const segments = line.split("|");
  const nonEmpty = segments.filter((seg) => seg.trim() !== "");
  if (nonEmpty.length === 0) return false;
  return nonEmpty.every((seg) => /^[\s:\-]+$/.test(seg.trim()));
}

/** Parse a pipe-delimited row into cells. */
function parseTableRow(line: string): string[] {
  const trimmed = line.trim();
  let content = trimmed;
  // Strip leading/trailing pipes
  if (content.startsWith("|")) content = content.slice(1);
  if (content.endsWith("|")) content = content.slice(0, -1);
  // Split on | and trim each cell
  return content.split("|").map((c) => c.trim());
}

/** Compute the minimum width needed for each column from all rows. */
function computeColWidths(rows: string[][]): number[] {
  const colCount = Math.max(...rows.map((r) => r.length));
  const widths = new Array(colCount).fill(0);
  for (const row of rows) {
    for (let c = 0; c < colCount; c++) {
      widths[c] = Math.max(widths[c], stringWidth(row[c] ?? ""));
    }
  }
  return widths;
}
