import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { resolveInsideCwd, resolveWritableInsideCwd } from "../path.js";
import { defineTool } from "../types.js";

export const writeFileTool = defineTool({
  name: "write_file",
  description:
    "Write UTF-8 text to a file, relative to the working directory. " +
    "Creates parent directories and overwrites any existing file.",
  schema: z.object({
    path: z.string().describe("File path, relative to the working directory."),
    content: z.string().describe("Full contents to write."),
  }),
  async execute({ path, content }, ctx) {
    const target = resolveInsideCwd(ctx.cwd, path);
    await mkdir(dirname(target), { recursive: true });
    const abs = await resolveWritableInsideCwd(ctx.cwd, path);
    await writeFile(abs, content, "utf8");
    return { content: `Wrote ${content.length} chars to ${path}` };
  },
});
