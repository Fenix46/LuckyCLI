import { readFile } from "node:fs/promises";
import { z } from "zod";
import { resolveExistingInsideCwd } from "../path.js";
import { defineTool } from "../types.js";

const MAX_BYTES = 256 * 1024;
const MAX_RANGE_LINES = 2_000;
/**
 * A whole-file read past this many lines gets a trailing nudge to read a
 * targeted range instead. Reading entire large files is the main token sink
 * after a graph hit already points at the relevant lines.
 */
const LARGE_READ_LINES = 400;

export const readFileTool = defineTool({
  name: "read_file",
  description:
    "Read a text file, relative to the working directory. Prefer a targeted " +
    "line range (offset + limit) over reading the whole file — when the graph " +
    "or a search has pointed you at a symbol, read just its definition plus a " +
    "little surrounding context. Read whole files only when you genuinely need " +
    "full-file understanding. Returns up to 256KB of UTF-8 text; 1-based line " +
    "numbers with offset and limit.",
  readonly: true,
  schema: z.object({
    path: z.string().describe("File path, relative to the working directory."),
    offset: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Optional 1-based line number to start reading from."),
    limit: z
      .number()
      .int()
      .positive()
      .max(MAX_RANGE_LINES)
      .optional()
      .describe(`Optional maximum number of lines to return, capped at ${MAX_RANGE_LINES}.`),
  }),
  async execute({ path, offset, limit }, ctx) {
    const abs = await resolveExistingInsideCwd(ctx.cwd, path);
    const buf = await readFile(abs);
    const truncated = buf.byteLength > MAX_BYTES;
    const text = buf.subarray(0, MAX_BYTES).toString("utf8");

    if (offset !== undefined || limit !== undefined) {
      return {
        content: formatLineRange(text, offset ?? 1, limit ?? MAX_RANGE_LINES, truncated),
      };
    }

    // Whole-file read: serve it, but on a large file nudge toward a targeted
    // range next time so the model doesn't keep pulling entire files.
    const lineCount = countLines(text);
    const notes: string[] = [];
    if (truncated) notes.push(`[truncated at ${MAX_BYTES} bytes]`);
    if (lineCount > LARGE_READ_LINES) {
      notes.push(
        `[read ${lineCount} lines; for a large file, prefer read_file with offset/limit on the relevant range]`,
      );
    }
    return { content: [text, ...notes].join("\n\n") };
  },
});

/** Line count of already-decoded text (one more than the newline count). */
function countLines(text: string): number {
  if (text === "") return 0;
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") n++;
  return n;
}

export function formatLineRange(
  text: string,
  offset: number,
  limit: number,
  truncatedByBytes = false,
): string {
  const allLines = text.split("\n");
  const startIndex = offset - 1;
  const selected = allLines.slice(startIndex, startIndex + limit);
  const body = selected
    .map((line, index) => `${String(startIndex + index + 1).padStart(6)}: ${line}`)
    .join("\n");

  const notes: string[] = [];
  if (selected.length === 0) notes.push(`[no lines at offset ${offset}]`);
  if (startIndex + limit < allLines.length) notes.push(`[showing ${selected.length} of ${allLines.length} lines]`);
  if (truncatedByBytes) notes.push(`[file truncated at ${MAX_BYTES} bytes before line range formatting]`);

  return [body, ...notes].filter(Boolean).join("\n\n");
}
