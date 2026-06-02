import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";

/** Directories never worth walking for code search. */
export const DEFAULT_IGNORE = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
]);
const execFileAsync = promisify(execFile);
const RG_MAX_BUFFER = 2 * 1024 * 1024;

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compile a glob into an anchored RegExp matched against a POSIX-style relative
 * path. Supports `**` (any number of path segments), `*` (within a segment),
 * `?`, and `{a,b}` alternation.
 */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i += 2;
        if (glob[i] === "/") i++; // let `**/` also match zero directories
        continue;
      }
      re += "[^/]*";
      i++;
      continue;
    }
    if (c === "?") {
      re += "[^/]";
      i++;
      continue;
    }
    if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end !== -1) {
        const options = glob
          .slice(i + 1, end)
          .split(",")
          .map(escapeRegex);
        re += `(?:${options.join("|")})`;
        i = end + 1;
        continue;
      }
    }
    re += escapeRegex(c);
    i++;
  }
  return new RegExp(`^${re}$`);
}

/**
 * Match a relative path against a glob. A pattern without a slash matches the
 * basename anywhere in the tree (like ripgrep's `--glob '*.ts'`); a pattern with
 * a slash matches the full relative path.
 */
export function matchGlob(pattern: string, relPath: string): boolean {
  const posix = relPath.split(sep).join("/");
  const re = globToRegExp(pattern);
  if (pattern.includes("/")) return re.test(posix);
  const base = posix.slice(posix.lastIndexOf("/") + 1);
  return re.test(base);
}

export interface WalkedFile {
  /** Path relative to the walk root, using the OS separator. */
  relPath: string;
  absPath: string;
  mtimeMs: number;
}

export async function runRipgrep(
  args: string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("rg", args, {
      cwd,
      maxBuffer: RG_MAX_BUFFER,
      ...(signal ? { signal } : {}),
    });
    return stdout;
  } catch (err) {
    const e = err as { code?: unknown; stdout?: string };
    if (e.code === 1) return e.stdout ?? "";
    if (e.code === "ENOENT") return undefined;
    return undefined;
  }
}

export function defaultIgnoreGlobs(): string[] {
  return [...DEFAULT_IGNORE].map((dir) => `!${dir}/**`);
}

/**
 * Recursively yield files under `root`, skipping common build/vendor
 * directories. Honours an abort signal between entries.
 */
export async function* walkFiles(
  root: string,
  signal?: AbortSignal,
): AsyncGenerator<WalkedFile> {
  const stack: string[] = [root];
  while (stack.length > 0) {
    if (signal?.aborted) return;
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable directory — skip
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (DEFAULT_IGNORE.has(entry.name)) continue;
        stack.push(abs);
      } else if (entry.isFile()) {
        let mtimeMs = 0;
        try {
          mtimeMs = (await stat(abs)).mtimeMs;
        } catch {
          // ignore stat failure; treat as oldest
        }
        yield { relPath: relative(root, abs), absPath: abs, mtimeMs };
      }
    }
  }
}
