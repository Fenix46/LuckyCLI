import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { resolveExistingInsideCwd } from "../path.js";
import { defineTool } from "../types.js";
import { defaultIgnoreGlobs, matchGlob, runRipgrep, walkFiles } from "./fs-search.js";

const MAX_MATCHES = 200;
const MAX_FILE_BYTES = 1024 * 1024; // skip files larger than 1MB

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
    "via `include` (e.g. '*.ts').",
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
  }),
  async execute({ pattern, path = ".", include }, ctx) {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Invalid regular expression: ${message}`, isError: true };
    }

    const root = await resolveExistingInsideCwd(ctx.cwd, path);
    const rgResult = await grepWithRipgrep(root, pattern, include, ctx.signal);
    if (rgResult) return formatHits(rgResult.hits, pattern, rgResult.truncated);

    const hits: { relPath: string; line: number; text: string; mtimeMs: number }[] = [];
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
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i]!)) {
          hits.push({
            relPath: file.relPath,
            line: i + 1,
            text: lines[i]!.trim().slice(0, 500),
            mtimeMs: file.mtimeMs,
          });
          if (hits.length >= MAX_MATCHES) {
            truncated = true;
            break outer;
          }
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
}

async function grepWithRipgrep(
  root: string,
  pattern: string,
  include?: string,
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
    ...(include ? ["--glob", include] : []),
    ...defaultIgnoreGlobs().flatMap((glob) => ["--glob", glob]),
    pattern,
    ".",
  ];
  const stdout = await runRipgrep(args, root, signal);
  if (stdout === undefined) return undefined;

  const hits = stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parseRipgrepLine)
    .filter((hit): hit is GrepHit => hit !== undefined);

  return { hits: hits.slice(0, MAX_MATCHES), truncated: hits.length >= MAX_MATCHES };
}

function parseRipgrepLine(line: string): GrepHit | undefined {
  const match = /^(.+?):(\d+):(.*)$/.exec(line);
  if (!match) return undefined;
  return {
    relPath: match[1]!.replace(/^\.\//, ""),
    line: Number(match[2]),
    text: match[3]!.trim().slice(0, 500),
  };
}

function formatHits(hits: GrepHit[], pattern: string, truncated: boolean) {
  if (hits.length === 0) {
    return { content: `No matches for /${pattern}/.` };
  }
  const body = hits.map((h) => `${h.relPath}:${h.line}: ${h.text}`).join("\n");
  const suffix = truncated ? `\n\n[stopped at ${MAX_MATCHES} matches]` : "";
  return { content: body + suffix };
}
