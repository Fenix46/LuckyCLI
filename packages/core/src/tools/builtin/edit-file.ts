import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { resolveExistingInsideCwd } from "../path.js";
import { defineTool } from "../types.js";
import { replace } from "./edit-replace.js";

export const editFileTool = defineTool({
  name: "edit_file",
  description:
    "Edit an existing text file by replacing an exact snippet, relative to the " +
    "working directory. Provide `oldString` copied from the current file content " +
    "and the `newString` to put in its place. Fails if `oldString` is missing or " +
    "matches more than one location — add surrounding context to disambiguate, or " +
    "set `replaceAll` to change every occurrence. Prefer this over write_file for " +
    "edits to existing files.",
  schema: z.object({
    path: z.string().describe("File path, relative to the working directory."),
    oldString: z
      .string()
      .describe("Exact text to find in the file, including its indentation."),
    newString: z.string().describe("Text to replace it with."),
    replaceAll: z
      .boolean()
      .optional()
      .describe("Replace every occurrence instead of requiring a unique match."),
  }),
  async execute({ path, oldString, newString, replaceAll }, ctx) {
    try {
      const abs = await resolveExistingInsideCwd(ctx.cwd, path);
      const original = await readFile(abs, "utf8");
      const updated = replace(original, oldString, newString, replaceAll ?? false);
      await writeFile(abs, updated, "utf8");
      ctx.onFilesChanged?.([path]);
      return { content: `Edited ${path}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Failed to edit ${path}: ${message}`, isError: true };
    }
  },
});
