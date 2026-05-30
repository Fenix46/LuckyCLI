import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { z } from "zod";
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
    const abs = isAbsolute(path) ? path : resolve(ctx.cwd, path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    return { content: `Wrote ${content.length} chars to ${path}` };
  },
});
