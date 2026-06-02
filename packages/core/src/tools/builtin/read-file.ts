import { readFile } from "node:fs/promises";
import { z } from "zod";
import { resolveExistingInsideCwd } from "../path.js";
import { defineTool } from "../types.js";

const MAX_BYTES = 256 * 1024;
const MAX_RANGE_LINES = 2_000;

export const readFileTool = defineTool({
  name: "read_file",
  description:
    "Read the contents of a text file, relative to the working directory. " +
    "Returns up to 256KB of UTF-8 text. Optionally read a 1-based line range " +
    "with offset and limit.",
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

    return {
      content: truncated ? `${text}\n\n[truncated at ${MAX_BYTES} bytes]` : text,
    };
  },
});

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
