import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { resolveExistingInsideCwd } from "../path.js";
import { defineTool } from "../types.js";
import { defaultIgnoreGlobs, matchGlob, runRipgrep, walkFiles } from "./fs-search.js";

const MAX_MATCHES = 200;
const MAX_FILE_BYTES = 1024 * 1024; // skip files larger than 1MB
const MAX_CONTEXT = 10; // cap context lines so a wide window can't blow up output

/** Heuristic binary check: a NUL byte in the first chunk. */
function looksBinary(buf: Buffer): boolean {
  const span = buf.subarray(0, 8192);
  return span.includes(0);
}

export const grepTool = defineTool({
  name: "grep",
  description:
    "Search file contents with a regular expression, relative to the working " +
    "directory. Returns matching lines as 'path:line: text', most recently " +
    "modified files first. Optionally restrict the files searched with a glob " +
    "via `include` (e.g. '*.ts'), and pass `context` to include N lines around " +
    "each match (cheaper than a follow-up read_file when you just need to see " +
    "the surrounding code).",
  readonly: true,
  schema: z.object({
    pattern: z.string().describe("Regular expression to search for."),
    path: z
      .string()
      .optional()
      .describe("Directory to search in, relative to the working directory (default '.')."),
    include: z
      .string()
      .optional()
      .describe("Only search files whose name matches this glob, e.g. '*.{ts,tsx}'."),
    context: z
      .number()
      .int()
      .min(0)
      .max(MAX_CONTEXT)
      .optional()
      .describe(`Lines of context to show around each match (0–${MAX_CONTEXT}, default 0).`),
  }),
  async execute({ pattern, path = ".", include, context = 0 }, ctx) {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Invalid regular expression: ${message}`, isError: true };
    }

    const root = await resolveExistingInsideCwd(ctx.cwd, path);
    const rgResult = await grepWithRipgrep(root, pattern, include, context, ctx.signal);
    if (rgResult) return formatHits(rgResult.hits, pattern, rgResult.truncated);

    const hits: (GrepHit & { mtimeMs: number })[] = [];
    let truncated = false;

    outer: for await (const file of walkFiles(root, ctx.signal)) {
      if (include && !matchGlob(include, file.relPath)) continue;

      let buf: Buffer;
      try {
        const info = await stat(file.absPath);
        if (info.size > MAX_FILE_BYTES) continue;
        buf = await readFile(file.absPath);
      } catch {
        continue;
      }
      if (looksBinary(buf)) continue;

      const lines = buf.toString("utf8").split("\n");
      // Track the highest context line already emitted for this file so adjacent
      // matches don't repeat overlapping context lines.
      let lastEmitted = -1;
      let matchCount = 0;
      for (let i = 0; i < lines.length; i++) {
        if (!regex.test(lines[i]!)) continue;
        const from = Math.max(context > 0 ? i - context : i, lastEmitted + 1);
        const to = Math.min(i + context, lines.length - 1);
        for (let j = from; j <= to; j++) {
          hits.push({
            relPath: file.relPath,
            line: j + 1,
            text: lines[j]!.trim().slice(0, 500),
            isMatch: j === i,
            mtimeMs: file.mtimeMs,
          });
        }
        lastEmitted = to;
        matchCount++;
        if (matchCount >= MAX_MATCHES) {
          truncated = true;
          break outer;
        }
      }
    }

    hits.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return formatHits(hits, pattern, truncated);
  },
});

interface GrepHit {
  relPath: string;
  line: number;
  text: string;
  /** True for a matched line, false for a context line (rendered with '-'). */
  isMatch: boolean;
}

async function grepWithRipgrep(
  root: string,
  pattern: string,
  include: string | undefined,
  context: number,
  signal?: AbortSignal,
): Promise<{ hits: GrepHit[]; truncated: boolean } | undefined> {
  const args = [
    "--line-number",
    "--no-heading",
    "--color",
    "never",
    "--max-count",
    String(MAX_MATCHES),
    "--max-filesize",
    String(MAX_FILE_BYTES),
    ...(context > 0 ? ["--context", String(context)] : []),
    ...(include ? ["--glob", include] : []),
    ...defaultIgnoreGlobs().flatMap((glob) => ["--glob", glob]),
    pattern,
    ".",
  ];
  const stdout = await runRipgrep(args, root, signal);
  if (stdout === undefined) return undefined;

  const hits = stdout
    .split(/\r?\n/)
    .filter((l) => l !== "" && l !== "--") // '--' separates context groups
    .map(parseRipgrepLine)
    .filter((hit): hit is GrepHit => hit !== undefined);

  // Truncation is measured in matches, not lines: context lines inflate the
  // line count but ripgrep's --max-count already bounds matches per file.
  const matchCount = hits.filter((h) => h.isMatch).length;
  return { hits, truncated: matchCount >= MAX_MATCHES };
}

// ripgrep prints matches as 'path:line:text' and context lines as
// 'path-line-text'. Tell them apart by the separator after the line number.
function parseRipgrepLine(line: string): GrepHit | undefined {
  const m = /^(.+?)([:-])(\d+)\2(.*)$/.exec(line);
  if (!m) return undefined;
  return {
    relPath: m[1]!.replace(/^\.\//, ""),
    line: Number(m[3]),
    text: m[4]!.trim().slice(0, 500),
    isMatch: m[2] === ":",
  };
}

function formatHits(hits: GrepHit[], pattern: string, truncated: boolean) {
  if (hits.length === 0) {
    return {
      content:
        `No matches for /${pattern}/. Try a looser pattern, a broader \`path\`, ` +
        `or widen \`include\`; if you know the symbol, graph_query is cheaper.`,
    };
  }
  const body = hits.map((h) => `${h.relPath}:${h.line}${h.isMatch ? ":" : "-"} ${h.text}`).join("\n");
  const suffix = truncated
    ? `\n\n[stopped at ${MAX_MATCHES} matches — narrow the pattern or set \`include\`]`
    : "";
  return { content: body + suffix };
}
