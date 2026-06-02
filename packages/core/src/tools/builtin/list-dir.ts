import { readdir } from "node:fs/promises";
import { z } from "zod";
import { resolveExistingInsideCwd } from "../path.js";
import { defineTool } from "../types.js";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1_000;

export const listDirTool = defineTool({
  name: "list_dir",
  description:
    "List files and directories in a given path relative to the working directory. " +
    "Returns a sorted list of entry names with their types (file, dir or other).",
  readonly: true,
  schema: z.object({
    path: z
      .string()
      .optional()
      .describe("Directory path relative to the working directory (default '.')."),
    limit: z
      .number()
      .int()
      .positive()
      .max(MAX_LIMIT)
      .optional()
      .describe(`Maximum number of entries to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`),
  }),
  async execute({ path = ".", limit = DEFAULT_LIMIT }, ctx) {
    try {
      const abs = await resolveExistingInsideCwd(ctx.cwd, path);
      const entries = await readdir(abs, { withFileTypes: true });
      const sorted = entries.sort((a, b) => entryRank(a) - entryRank(b) || a.name.localeCompare(b.name));
      const shown = sorted.slice(0, limit);
      const lines = shown.map((entry) => `${entry.name} (${entryType(entry)})`);
      const suffix = sorted.length > shown.length
        ? `\n\n[showing first ${shown.length} of ${sorted.length} entries]`
        : "";
      return {
        content: lines.length > 0 ? lines.join("\n") + suffix : "(empty directory)",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Failed to list directory: ${message}`, isError: true };
    }
  },
});

function entryType(entry: { isDirectory(): boolean; isFile(): boolean }): "dir" | "file" | "other" {
  if (entry.isDirectory()) return "dir";
  if (entry.isFile()) return "file";
  return "other";
}

function entryRank(entry: { isDirectory(): boolean; isFile(): boolean }): number {
  if (entry.isDirectory()) return 0;
  if (entry.isFile()) return 1;
  return 2;
}
