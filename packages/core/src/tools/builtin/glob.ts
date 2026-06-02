import { z } from "zod";
import { resolveExistingInsideCwd } from "../path.js";
import { defineTool } from "../types.js";
import { defaultIgnoreGlobs, matchGlob, runRipgrep, walkFiles } from "./fs-search.js";

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
    const root = await resolveExistingInsideCwd(ctx.cwd, path);
    const rgMatches = await globWithRipgrep(root, pattern, ctx.signal);
    if (rgMatches) return formatGlobMatches(rgMatches, pattern);

    const matches: { relPath: string; mtimeMs: number }[] = [];
    for await (const file of walkFiles(root, ctx.signal)) {
      if (matchGlob(pattern, file.relPath)) {
        matches.push({ relPath: file.relPath, mtimeMs: file.mtimeMs });
      }
    }

    matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return formatGlobMatches(matches.map((m) => m.relPath), pattern);
  },
});

async function globWithRipgrep(
  root: string,
  pattern: string,
  signal?: AbortSignal,
): Promise<string[] | undefined> {
  const stdout = await runRipgrep(
    ["--files", "--glob", pattern, ...defaultIgnoreGlobs()],
    root,
    signal,
  );
  if (stdout === undefined) return undefined;
  return stdout.split(/\r?\n/).filter(Boolean);
}

function formatGlobMatches(matches: string[], pattern: string) {
  if (matches.length === 0) {
    return { content: `No files matching '${pattern}'.` };
  }
  const truncated = matches.length > LIMIT;
  const shown = matches.slice(0, LIMIT);
  const suffix = truncated
    ? `\n\n[showing first ${LIMIT} of ${matches.length} matches]`
    : "";
  return { content: shown.join("\n") + suffix };
}
