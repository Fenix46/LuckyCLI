import { readdir } from "node:fs/promises";
import { z } from "zod";
import { resolveInsideCwd } from "../path.js";
import { defineTool } from "../types.js";

export const listDirTool = defineTool({
  name: "list_dir",
  description:
    "List files and directories in a given path relative to the working directory. " +
    "Returns a list of entry names with their types (file or dir).",
  readonly: true,
  schema: z.object({
    path: z
      .string()
      .optional()
      .describe("Directory path relative to the working directory (default '.')."),
  }),
  async execute({ path = "." }, ctx) {
    try {
      const abs = resolveInsideCwd(ctx.cwd, path);
      const entries = await readdir(abs, { withFileTypes: true });
      const lines = entries.map((entry) => {
        const type = entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other";
        return `${entry.name} (${type})`;
      });
      return {
        content: lines.length > 0 ? lines.join("\n") : "(empty directory)",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Failed to list directory: ${message}`, isError: true };
    }
  },
});
