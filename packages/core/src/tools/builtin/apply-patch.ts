import { mkdir, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { fileDiff, type FileDiff } from "../../diff.js";
import { readTextViaContext, writeTextViaContext } from "../file-access.js";
import {
  assertParentPathInsideCwd,
  resolveExistingInsideCwd,
  resolveInsideCwd,
  resolveWritableInsideCwd,
} from "../path.js";
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
      const diffs: FileDiff[] = [];
      for (const file of files) {
        if (file.operation === "add") {
          const target = resolveInsideCwd(ctx.cwd, file.path);
          await assertParentPathInsideCwd(ctx.cwd, file.path);
          await mkdir(dirname(target), { recursive: true });
          const abs = await resolveWritableInsideCwd(ctx.cwd, file.path);
          const updated = applyFilePatch("", file);
          await writeTextViaContext(ctx, abs, updated);
          diffs.push(fileDiff(file.path, "", updated, { created: true }));
        } else if (file.operation === "delete") {
          const abs = await resolveExistingInsideCwd(ctx.cwd, file.path);
          const original = await readTextViaContext(ctx, abs);
          const updated = applyFilePatch(original, file);
          if (updated.length > 0) {
            throw new Error(`Delete patch for ${file.path} did not remove all content.`);
          }
          // Deletion has no host channel; it lands on disk either way.
          await unlink(abs);
          diffs.push(fileDiff(file.path, original, ""));
        } else {
          const abs = await resolveExistingInsideCwd(ctx.cwd, file.path);
          const original = await readTextViaContext(ctx, abs);
          const updated = applyFilePatch(original, file);
          await writeTextViaContext(ctx, abs, updated);
          diffs.push(fileDiff(file.path, original, updated));
        }
        changed.push(file.path);
      }

      if (changed.length > 0) ctx.onFilesChanged?.(changed);
      return {
        content: `Applied patch to ${changed.length} file(s): ${changed.join(", ")}`,
        metadata: { diff: diffs },
      };
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

/**
 * Dry-run of {@link applyPatchTool}: the same parse + apply pipeline, but the
 * result is only diffed, never written. Used to show a real diff *before* the
 * user approves the call — the file contents come from `readFile`, so a host
 * with unsaved editor buffers previews what the tool would actually see.
 *
 * `readFile` resolves undefined for a file that doesn't exist. Errors (bad
 * patch, unreadable file, failed context match) propagate: a caller that only
 * wants a best-effort preview catches them and shows none.
 */
export async function previewPatch(
  patch: string,
  readFile: (path: string) => Promise<string | undefined>,
): Promise<FileDiff[]> {
  const files = parseUnifiedDiff(patch);
  if (files.length === 0) throw new Error("No file patches found.");

  const diffs: FileDiff[] = [];
  for (const file of files) {
    if (file.operation === "add") {
      diffs.push(fileDiff(file.path, "", applyFilePatch("", file), { created: true }));
      continue;
    }
    const original = await readFile(file.path);
    if (original === undefined) throw new Error(`File not found: ${file.path}`);
    if (file.operation === "delete") {
      diffs.push(fileDiff(file.path, original, ""));
    } else {
      diffs.push(fileDiff(file.path, original, applyFilePatch(original, file)));
    }
  }
  return diffs;
}

interface Hunk {
  // `oldStart < 0` means the position is unknown (Codex `*** Begin Patch`
  // hunks carry no @@ line numbers); applyFilePatch locates it by context.
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

export function parseUnifiedDiff(patch: string): FilePatch[] {
  // Codex (ChatGPT OAuth) is trained to emit OpenAI's `*** Begin Patch`
  // envelope, not classic unified diff. Detect and route to that parser so the
  // tool works regardless of which provider produced the patch.
  if (/^\*\*\* Begin Patch/m.test(patch)) {
    return parseBeginPatch(patch);
  }

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
  let searchFrom = 0;
  for (const hunk of patch.hunks) {
    const start =
      hunk.oldStart < 0
        ? locateHunk(lines, hunk, searchFrom)
        : (hunk.oldStart === 0 ? 0 : hunk.oldStart - 1) + offset;
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
    searchFrom = start + replacement.length;
  }

  const out = lines.join("\n");
  if (out.length === 0) return "";
  return hadTrailingNewline ? `${out}\n` : out;
}

/**
 * Find where a position-less hunk (Codex `*** Begin Patch`) applies by matching
 * its context + removal lines against the file, starting at `from`.
 */
function locateHunk(lines: string[], hunk: Hunk, from: number): number {
  const anchor = hunk.lines
    .filter((line) => line.startsWith(" ") || line.startsWith("-"))
    .map((line) => line.slice(1));
  // A pure-insertion hunk (only `+` lines) has no anchor; apply at `from`.
  if (anchor.length === 0) return from;

  for (let start = from; start + anchor.length <= lines.length; start++) {
    let match = true;
    for (let j = 0; j < anchor.length; j++) {
      if (lines[start + j] !== anchor[j]) {
        match = false;
        break;
      }
    }
    if (match) return start;
  }
  throw new Error(`Could not locate context for hunk: ${JSON.stringify(anchor[0] ?? "")}.`);
}

/**
 * Parse OpenAI's `*** Begin Patch` envelope (the format Codex / ChatGPT OAuth
 * emits). Hunks carry no line numbers, so each is recorded with `oldStart: -1`
 * and located by context at apply time.
 */
export function parseBeginPatch(patch: string): FilePatch[] {
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  const files: FilePatch[] = [];
  let current: FilePatch | undefined;
  let hunk: Hunk | undefined;
  let started = false;

  const pushHunk = () => {
    if (current && hunk && hunk.lines.length > 0) {
      finalizeBeginHunk(hunk);
      current.hunks.push(hunk);
    }
    hunk = undefined;
  };

  for (const line of lines) {
    if (line.startsWith("*** Begin Patch")) {
      started = true;
      continue;
    }
    if (line.startsWith("*** End Patch")) {
      pushHunk();
      break;
    }
    if (!started) continue;

    const fileHeader = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
    if (fileHeader) {
      pushHunk();
      const op = fileHeader[1]!;
      current = {
        path: cleanDiffPath(fileHeader[2]!.trim()),
        operation: op === "Add" ? "add" : op === "Delete" ? "delete" : "update",
        hunks: [],
      };
      files.push(current);
      continue;
    }

    // `*** Move to: ...` and other directives are not supported; ignore the
    // line rather than treating it as a hunk body line.
    if (line.startsWith("*** ")) continue;
    if (!current) continue;

    if (line.startsWith("@@")) {
      // Section marker. Begin a fresh hunk; the @@ text itself is context we do
      // not consume (it just helps the model anchor).
      pushHunk();
      hunk = { oldStart: -1, oldCount: 0, newStart: -1, newCount: 0, lines: [] };
      continue;
    }

    if (/^[ +\-]/.test(line)) {
      hunk ??= { oldStart: -1, oldCount: 0, newStart: -1, newCount: 0, lines: [] };
      hunk.lines.push(line);
      continue;
    }

    // A blank line with no prefix is treated as a blank context line.
    if (line === "") {
      hunk ??= { oldStart: -1, oldCount: 0, newStart: -1, newCount: 0, lines: [] };
      hunk.lines.push(" ");
    }
  }

  pushHunk();
  if (files.length === 0) throw new Error("No file patches found.");
  return files;
}

function finalizeBeginHunk(hunk: Hunk): void {
  hunk.oldCount = hunk.lines.filter((l) => l.startsWith(" ") || l.startsWith("-")).length;
  hunk.newCount = hunk.lines.filter((l) => l.startsWith(" ") || l.startsWith("+")).length;
}
