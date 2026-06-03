import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { resolveExistingInsideCwd, resolveInsideCwd, resolveWritableInsideCwd } from "../path.js";
import { defineTool } from "../types.js";

export const applyPatchTool = defineTool({
  name: "apply_patch",
  description:
    "Apply a simple unified diff patch to text files, relative to the " +
    "working directory. Supports standard hunks with ---/+++ file headers and " +
    "@@ ranges. Use for precise multi-line edits when edit_file is awkward. " +
    "Can create, update, and delete files. Does not rename files or accept " +
    "absolute/outside paths.",
  schema: z.object({
    patch: z.string().describe("Unified diff text to apply."),
  }),
  async execute({ patch }, ctx) {
    try {
      const files = parseUnifiedDiff(patch);
      if (files.length === 0) throw new Error("No file patches found.");

      const changed: string[] = [];
      for (const file of files) {
        if (file.operation === "add") {
          const target = resolveInsideCwd(ctx.cwd, file.path);
          await mkdir(dirname(target), { recursive: true });
          const abs = await resolveWritableInsideCwd(ctx.cwd, file.path);
          const updated = applyFilePatch("", file);
          await writeFile(abs, updated, "utf8");
        } else if (file.operation === "delete") {
          const abs = await resolveExistingInsideCwd(ctx.cwd, file.path);
          const original = await readFile(abs, "utf8");
          const updated = applyFilePatch(original, file);
          if (updated.length > 0) {
            throw new Error(`Delete patch for ${file.path} did not remove all content.`);
          }
          await unlink(abs);
        } else {
          const abs = await resolveExistingInsideCwd(ctx.cwd, file.path);
          const original = await readFile(abs, "utf8");
          const updated = applyFilePatch(original, file);
          await writeFile(abs, updated, "utf8");
        }
        changed.push(file.path);
      }

      if (changed.length > 0) ctx.onFilesChanged?.(changed);
      return { content: `Applied patch to ${changed.length} file(s): ${changed.join(", ")}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: `Failed to apply patch: ${message}`, isError: true };
    }
  },
});

interface FilePatch {
  path: string;
  operation: "add" | "delete" | "update";
  hunks: Hunk[];
}

interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

export function parseUnifiedDiff(patch: string): FilePatch[] {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const files: FilePatch[] = [];
  let current: FilePatch | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("--- ")) {
      const oldPath = cleanDiffPath(line.slice(4).trim());
      const next = lines[i + 1];
      if (!next?.startsWith("+++ ")) throw new Error("Expected +++ after --- header.");
      const newPath = cleanDiffPath(next.slice(4).trim());
      if (oldPath === "/dev/null" && newPath === "/dev/null") {
        throw new Error("Patch cannot use /dev/null for both old and new paths.");
      }
      const operation = oldPath === "/dev/null" ? "add" : newPath === "/dev/null" ? "delete" : "update";
      current = {
        path: operation === "delete" ? oldPath : newPath,
        operation,
        hunks: [],
      };
      files.push(current);
      i++;
      continue;
    }

    if (line.startsWith("@@ ")) {
      if (!current) throw new Error("Hunk found before file header.");
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!match) throw new Error(`Invalid hunk header: ${line}`);
      const hunk: Hunk = {
        oldStart: Number(match[1]),
        oldCount: match[2] ? Number(match[2]) : 1,
        newStart: Number(match[3]),
        newCount: match[4] ? Number(match[4]) : 1,
        lines: [],
      };
      i++;
      while (i < lines.length) {
        const hunkLine = lines[i]!;
        if (hunkLine.startsWith("@@ ") || hunkLine.startsWith("--- ")) {
          i--;
          break;
        }
        if (hunkLine === "\\ No newline at end of file") {
          i++;
          continue;
        }
        // A trailing newline after the final hunk becomes an empty split item;
        // it is not an actual unified-diff hunk line.
        if (hunkLine === "" && i === lines.length - 1) {
          i++;
          break;
        }
        if (!/^[ +\-]/.test(hunkLine)) {
          throw new Error(`Invalid hunk line: ${hunkLine}`);
        }
        hunk.lines.push(hunkLine);
        i++;
      }
      validateHunk(hunk);
      current.hunks.push(hunk);
    }
  }

  return files;
}

function cleanDiffPath(raw: string): string {
  const path = raw.split(/\s+/)[0] ?? "";
  if (path === "/dev/null") return path;
  return path.replace(/^[ab]\//, "");
}

function validateHunk(hunk: Hunk): void {
  const oldLines = hunk.lines.filter((line) => line.startsWith(" ") || line.startsWith("-")).length;
  const newLines = hunk.lines.filter((line) => line.startsWith(" ") || line.startsWith("+")).length;
  if (oldLines !== hunk.oldCount) {
    throw new Error(`Hunk old line count mismatch: expected ${hunk.oldCount}, got ${oldLines}.`);
  }
  if (newLines !== hunk.newCount) {
    throw new Error(`Hunk new line count mismatch: expected ${hunk.newCount}, got ${newLines}.`);
  }
}

export function applyFilePatch(content: string, patch: FilePatch): string {
  const hadTrailingNewline = content.endsWith("\n");
  const lines = content.replace(/\n$/, "").split("\n");
  if (content === "") lines.splice(0, lines.length);

  let offset = 0;
  for (const hunk of patch.hunks) {
    const start = (hunk.oldStart === 0 ? 0 : hunk.oldStart - 1) + offset;
    if (start < 0 || start > lines.length) throw new Error(`Hunk starts outside file: ${hunk.oldStart}.`);

    const replacement: string[] = [];
    let cursor = start;
    for (const raw of hunk.lines) {
      const kind = raw[0];
      const text = raw.slice(1);
      if (kind === " ") {
        if (lines[cursor] !== text) {
          throw new Error(`Context mismatch near line ${cursor + 1}: expected ${JSON.stringify(text)}.`);
        }
        replacement.push(text);
        cursor++;
      } else if (kind === "-") {
        if (lines[cursor] !== text) {
          throw new Error(`Removal mismatch near line ${cursor + 1}: expected ${JSON.stringify(text)}.`);
        }
        cursor++;
      } else if (kind === "+") {
        replacement.push(text);
      } else {
        throw new Error(`Invalid hunk line prefix: ${kind}`);
      }
    }

    lines.splice(start, cursor - start, ...replacement);
    offset += replacement.length - (cursor - start);
  }

  const out = lines.join("\n");
  if (out.length === 0) return "";
  return hadTrailingNewline ? `${out}\n` : out;
}
