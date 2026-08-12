import { z } from "zod";
import { fileDiff } from "../../diff.js";
import { readTextViaContext, writeTextViaContext } from "../file-access.js";
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
      // Through the context, so an editor's unsaved buffer is what gets
      // matched and edited (falls back to disk when the host has no view).
      const original = await readTextViaContext(ctx, abs);
      const updated = replace(original, oldString, newString, replaceAll ?? false);
      await writeTextViaContext(ctx, abs, updated);
      ctx.onFilesChanged?.([path]);
      const diff = fileDiff(path, original, updated);
      return {
        content: `Edited ${path} (+${diff.additions} -${diff.deletions})`,
        metadata: { diff: [diff] },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Failed to edit ${path}: ${message}`, isError: true };
    }
  },
});
