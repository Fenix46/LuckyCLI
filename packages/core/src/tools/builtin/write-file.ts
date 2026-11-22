import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { fileDiff } from "../../diff.js";
import { describeFileStateFailure } from "../file-state.js";
import { tryReadTextViaContext, writeTextViaContext } from "../file-access.js";
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
    // for overwrites and a pure-addition diff for creations. Read through the
    // context so an editor's unsaved buffer counts as the current contents.
    const original = await tryReadTextViaContext(ctx, abs);
    if (overwrite === false && original !== undefined) {
      return {
        content: `Refusing to overwrite existing file: ${path}. Retry with overwrite=true if intended.`,
        isError: true,
      };
    }
    // Overwriting an existing file is a blind mutation unless the model has
    // seen that exact content. A new file needs no prior read.
    if (ctx.fileState && original !== undefined) {
      const state = ctx.fileState.check(abs, original);
      if (!state.ok) {
        return { content: describeFileStateFailure(path, state.reason), isError: true };
      }
    }
    if (ctx.writeTextFile) {
      await writeTextViaContext(ctx, abs, content);
    } else {
      // Direct disk path keeps the atomic wx guard against a create race.
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
    }
    ctx.fileState?.recordWrite(abs, content);
    ctx.onFilesChanged?.([path]);
    const diff = fileDiff(path, original ?? "", content, { created: original === undefined });
    return {
      content: `Wrote ${content.length} chars to ${path}`,
      metadata: { diff: [diff] },
    };
  },
});
