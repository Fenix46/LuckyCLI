import { z } from "zod";
import { resolveInsideCwd } from "../path.js";
import { defineTool } from "../types.js";
import { matchGlob, walkFiles } from "./fs-search.js";

const LIMIT = 100;

export const globTool = defineTool({
  name: "glob",
  description:
    "Find files by name using a glob pattern (e.g. '*.ts', 'src/**/*.tsx'), " +
    "relative to the working directory. Returns matching paths, most recently " +
    "modified first. Use this to locate files when you don't know their exact path.",
  readonly: true,
  schema: z.object({
    pattern: z.string().describe("Glob pattern, e.g. '**/*.ts' or 'src/*.json'."),
    path: z
      .string()
      .optional()
      .describe("Directory to search in, relative to the working directory (default '.')."),
  }),
  async execute({ pattern, path = "." }, ctx) {
    const root = resolveInsideCwd(ctx.cwd, path);
    const matches: { relPath: string; mtimeMs: number }[] = [];
    for await (const file of walkFiles(root, ctx.signal)) {
      if (matchGlob(pattern, file.relPath)) {
        matches.push({ relPath: file.relPath, mtimeMs: file.mtimeMs });
      }
    }

    if (matches.length === 0) {
      return { content: `No files matching '${pattern}'.` };
    }

    matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const truncated = matches.length > LIMIT;
    const shown = matches.slice(0, LIMIT).map((m) => m.relPath);
    const suffix = truncated
      ? `\n\n[showing first ${LIMIT} of ${matches.length} matches]`
      : "";
    return { content: shown.join("\n") + suffix };
  },
});
