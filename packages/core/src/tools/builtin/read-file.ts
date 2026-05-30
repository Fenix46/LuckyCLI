import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { defineTool } from "../types.js";

const MAX_BYTES = 256 * 1024;

export const readFileTool = defineTool({
  name: "read_file",
  description:
    "Read the contents of a text file, relative to the working directory. " +
    "Returns up to 256KB of UTF-8 text.",
  readonly: true,
  schema: z.object({
    path: z.string().describe("File path, relative to the working directory."),
  }),
  async execute({ path }, ctx) {
    const abs = isAbsolute(path) ? path : resolve(ctx.cwd, path);
    const buf = await readFile(abs);
    const truncated = buf.byteLength > MAX_BYTES;
    const text = buf.subarray(0, MAX_BYTES).toString("utf8");
    return {
      content: truncated ? `${text}\n\n[truncated at ${MAX_BYTES} bytes]` : text,
    };
  },
});
