import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { fileDiff } from "../../diff.js";
import { assertParentPathInsideCwd, resolveInsideCwd, resolveWritableInsideCwd } from "../path.js";
import { defineTool } from "../types.js";

export const writeFileTool = defineTool({
  name: "write_file",
  description:
    "Write UTF-8 text to a file, relative to the working directory. " +
    "Creates parent directories and overwrites any existing file.",
  schema: z.object({
    path: z.string().describe("File path, relative to the working directory."),
    content: z.string().describe("Full contents to write."),
    overwrite: z
      .boolean()
      .optional()
      .describe("Whether to overwrite an existing file. Defaults to true for backward compatibility."),
  }),
  async execute({ path, content, overwrite }, ctx) {
    const target = resolveInsideCwd(ctx.cwd, path);
    await assertParentPathInsideCwd(ctx.cwd, path);
    await mkdir(dirname(target), { recursive: true });
    const abs = await resolveWritableInsideCwd(ctx.cwd, path);
    // Capture the previous contents (if any) so the UI can show a real diff
    // for overwrites and a pure-addition diff for creations.
    let original: string | undefined;
    try {
      original = await readFile(abs, "utf8");
    } catch {
      original = undefined;
    }
    try {
      await writeFile(abs, content, {
        encoding: "utf8",
        flag: overwrite === false ? "wx" : "w",
      });
    } catch (err) {
      const error = err as { code?: unknown };
      if (error.code === "EEXIST") {
        return {
          content: `Refusing to overwrite existing file: ${path}. Retry with overwrite=true if intended.`,
          isError: true,
        };
      }
      throw err;
    }
    ctx.onFilesChanged?.([path]);
    const diff = fileDiff(path, original ?? "", content, { created: original === undefined });
    return {
      content: `Wrote ${content.length} chars to ${path}`,
      metadata: { diff: [diff] },
    };
  },
});
