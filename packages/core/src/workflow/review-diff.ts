import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { loadSnapshot, readSnapshotFile } from "./snapshot.js";
import { fileDiff } from "../diff.js";

const execFileAsync = promisify(execFile);

export const DEFAULT_REVIEW_MAX_FILES = 100;
export const DEFAULT_REVIEW_MAX_CHARS = 40_000;

export type ReviewDiffSource = "head" | "staged" | "unstaged" | { checkpointId: string };

export interface ReviewDiffFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "unknown";
  source: string;
  patch?: string;
  summary?: string;
  binary: boolean;
  truncated: boolean;
  additions: number;
  deletions: number;
}

export interface ReviewDiffResult {
  cwd: string;
  source: string;
  files: ReviewDiffFile[];
  truncated: boolean;
  totalChars: number;
}

export interface ReviewDiffOptions {
  cwd: string;
  source: ReviewDiffSource;
  maxFiles?: number;
  maxChars?: number;
  context?: number;
  redact?: boolean;
}

/** Collect a bounded, in-memory diff suitable for a model review. */
export async function collectReviewDiff(options: ReviewDiffOptions): Promise<ReviewDiffResult> {
  const cwd = resolve(options.cwd);
  const maxFiles = options.maxFiles ?? DEFAULT_REVIEW_MAX_FILES;
  const maxChars = options.maxChars ?? DEFAULT_REVIEW_MAX_CHARS;
  if (!Number.isInteger(maxFiles) || maxFiles < 1) throw new Error("maxFiles must be a positive integer");
  if (!Number.isInteger(maxChars) || maxChars < 1) throw new Error("maxChars must be a positive integer");

  if (typeof options.source === "object") {
    return collectCheckpointDiff(cwd, options.source.checkpointId, maxFiles, maxChars, options);
  }

  const args = options.source === "staged"
    ? ["diff", "--cached", "--name-status", "-z"]
    : ["diff", ...(options.source === "head" ? ["HEAD"] : []), "--name-status", "-z"];
  const names = await git(cwd, args);
  const entries = parseNameStatus(names);
  if (options.source === "unstaged") {
    const untracked = (await git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]))
      .split("\0").filter(Boolean).map((path) => ({ path, status: "added" as const, untracked: true }));
    entries.push(...untracked);
  }
  const files: ReviewDiffFile[] = [];
  let totalChars = 0;
  let truncated = entries.length > maxFiles;
  for (const entry of entries.slice(0, maxFiles)) {
    const patchArgs = options.source === "staged"
      ? ["diff", "--cached", `--unified=${options.context ?? 3}`, "--no-color", "--", entry.path]
      : ["diff", ...(options.source === "head" ? ["HEAD"] : []), `--unified=${options.context ?? 3}`, "--no-color", "--", entry.path];
    const raw = entry.untracked ? await untrackedPatch(cwd, entry.path) : await git(cwd, patchArgs);
    const binary = raw.includes("Binary files") || raw.includes("GIT binary patch");
    const content = binary ? undefined : redactText(raw, options.redact !== false);
    const remaining = maxChars - totalChars;
    const patch = content === undefined ? undefined : content.slice(0, Math.max(0, remaining));
    const fileTruncated = content !== undefined && content.length > Math.max(0, remaining);
    if (fileTruncated) truncated = true;
    const visible = patch ?? `[binary file: ${entry.path}]`;
    totalChars += visible.length;
    files.push({
      path: entry.path,
      status: entry.status,
      source: sourceLabel(options.source),
      ...(patch ? { patch } : {}),
      ...(binary ? { summary: "binary file changed" } : {}),
      binary,
      truncated: fileTruncated,
      additions: countPatchLines(raw, /^\+(?!\+\+)/),
      deletions: countPatchLines(raw, /^-(?!-\-)/),
    });
    if (totalChars >= maxChars) break;
  }
  return { cwd, source: sourceLabel(options.source), files, truncated, totalChars };
}

async function collectCheckpointDiff(
  cwd: string,
  checkpointId: string,
  maxFiles: number,
  maxChars: number,
  options: ReviewDiffOptions,
): Promise<ReviewDiffResult> {
  const snapshot = await loadSnapshot(cwd, checkpointId);
  const files: ReviewDiffFile[] = [];
  let totalChars = 0;
  let truncated = snapshot.files.length > maxFiles;
  for (const file of snapshot.files.slice(0, maxFiles)) {
    const target = safePath(cwd, file.path);
    const beforeBytes = file.existed ? await readSnapshotFile(cwd, snapshot, file.path) : undefined;
    const before = beforeBytes?.toString("utf8") ?? "";
    let afterBytes: Buffer | undefined;
    try { afterBytes = await readFile(target); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const after = afterBytes?.toString("utf8") ?? "";
    if (before === after && Boolean(afterBytes) === file.existed) continue;
    const binary = Boolean(beforeBytes?.includes(0) || afterBytes?.includes(0));
    const rawPatch = binary ? `Binary files a/${file.path} and b/${file.path} differ` : renderFilePatch(file.path, before, after);
    const patch = binary ? undefined : redactText(rawPatch, options.redact !== false);
    const remaining = maxChars - totalChars;
    const visible = (patch ?? `[binary file: ${file.path}]`).slice(0, Math.max(0, remaining));
    const fileTruncated = rawPatch.length > Math.max(0, remaining);
    if (fileTruncated) truncated = true;
    totalChars += visible.length;
    files.push({
      path: file.path,
      status: !file.existed ? "added" : after === "" ? "deleted" : "modified",
      source: `checkpoint:${checkpointId}`,
      ...(patch ? { patch: visible } : {}),
      ...(binary ? { summary: "binary file changed" } : {}),
      binary,
      truncated: fileTruncated,
      additions: binary ? 0 : countPatchLines(rawPatch, /^\+(?!\+\+)/),
      deletions: binary ? 0 : countPatchLines(rawPatch, /^-(?!-\-)/),
    });
    if (totalChars >= maxChars) break;
  }
  return { cwd, source: `checkpoint:${checkpointId}`, files, truncated, totalChars };
}

function renderFilePatch(path: string, before: string, after: string): string {
  const diff = fileDiff(path, before, after);
  const lines = diff.hunks.flatMap((hunk) => [
    `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    ...hunk.lines.map((line) => `${line.type === "add" ? "+" : line.type === "del" ? "-" : " "}${line.text}`),
  ]);
  return [`diff --git a/${path} b/${path}`, `--- ${before ? `a/${path}` : "/dev/null"}`, `+++ ${after ? `b/${path}` : "/dev/null"}`, ...lines].join("\n");
}

function parseNameStatus(raw: string): Array<{ path: string; status: ReviewDiffFile["status"]; untracked?: boolean }> {
  const parts = raw.split("\0").filter(Boolean);
  const entries: Array<{ path: string; status: ReviewDiffFile["status"] }> = [];
  for (let i = 0; i < parts.length;) {
    const code = parts[i++]!.charAt(0);
    const firstPath = parts[i++]!;
    const path = code === "R" || code === "C" ? parts[i++]! : firstPath;
    const status = code === "A" ? "added" : code === "D" ? "deleted" : code === "M" ? "modified" : code === "R" ? "renamed" : code === "C" ? "copied" : "unknown";
    entries.push({ path, status });
  }
  return entries;
}

async function untrackedPatch(cwd: string, path: string): Promise<string> {
  const target = safePath(cwd, path);
  const bytes = await readFile(target);
  if (bytes.includes(0)) return `Binary files /dev/null and b/${path} differ`;
  return `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n${bytes.toString("utf8")}`;
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 2_000_000 });
    return result.stdout;
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`unable to collect git diff in ${cwd}: ${details}`);
  }
}

function safePath(cwd: string, path: string): string {
  const target = resolve(cwd, path);
  const rel = relative(cwd, target);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith("..")) throw new Error(`diff path escapes working directory: ${path}`);
  return target;
}

function sourceLabel(source: ReviewDiffSource): string {
  return typeof source === "object" ? `checkpoint:${source.checkpointId}` : source;
}

function countPatchLines(raw: string, pattern: RegExp): number {
  return raw.split("\n").filter((line) => pattern.test(line)).length;
}

function redactText(text: string, enabled: boolean): string {
  if (!enabled) return text;
  return text
    .replace(/(\b(?:api[_-]?key|token|password|passwd|secret|authorization)\b\s*[:=]\s*["']?)([^\s"']{8,})/gi, "$1[REDACTED]")
    .replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[REDACTED]");
}
