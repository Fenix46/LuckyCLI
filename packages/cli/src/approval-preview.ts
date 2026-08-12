/**
 * Pre-execution diff preview for the write tools.
 *
 * Both approval surfaces — the TUI's permission panel and the ACP permission
 * request an editor renders — need to answer the same question before the tool
 * runs: *what exactly would this change?* This module turns a tool name plus
 * its raw input into `FileDiff[]`, using the same diff engine the tools
 * themselves use afterwards, so the pre-approval diff and the post-execution
 * diff line up.
 *
 * The one input the preview needs beyond the tool args is a way to read the
 * current file contents. Callers pass a reader; the ACP server points it at the
 * editor's `fs/read_text_file` (unsaved buffers included), the TUI reads disk.
 * With no reader at all the preview degrades gracefully: `edit_file` diffs the
 * snippet alone (old behavior), `write_file` shows a creation, `apply_patch`
 * has nothing to show.
 *
 * Nothing here throws: a malformed patch, a missing file or a snippet that no
 * longer matches yields no diff, never a broken approval prompt.
 */
import { fileDiff, previewPatch, replaceSnippet, type FileDiff } from "@luckycli/core";

/**
 * Reads the current contents of a path (as the tool wrote it, i.e. relative to
 * the session cwd). Resolves undefined when the file does not exist or cannot
 * be read.
 */
export type PreviewFileReader = (path: string) => Promise<string | undefined>;

/** Tools whose approval can show a diff of the change they would make. */
export const PREVIEWABLE_TOOLS = new Set(["edit_file", "write_file", "apply_patch"]);

function inputString(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function inputBoolean(input: unknown, key: string): boolean | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : undefined;
}

/**
 * The diffs `name(input)` would produce if it ran now, or an empty array when
 * the tool has no file change to preview (or the preview cannot be computed).
 */
export async function previewToolDiffs(
  name: string,
  input: unknown,
  readFile?: PreviewFileReader,
): Promise<FileDiff[]> {
  try {
    switch (name) {
      case "edit_file":
        return await previewEdit(input, readFile);
      case "write_file":
        return await previewWrite(input, readFile);
      case "apply_patch":
        return await previewApplyPatch(input, readFile);
      default:
        return [];
    }
  } catch {
    // A preview is a nicety; a failure here must never block the approval.
    return [];
  }
}

async function previewEdit(input: unknown, readFile?: PreviewFileReader): Promise<FileDiff[]> {
  const path = inputString(input, "path");
  const oldString = inputString(input, "oldString") ?? "";
  const newString = inputString(input, "newString") ?? "";
  const label = path ?? "(unknown file)";

  if (path && readFile) {
    const original = await readFile(path);
    if (original !== undefined) {
      // The real thing: run the same replacement engine the tool will run, so
      // the diff carries true file line numbers and surrounding context.
      const updated = replaceSnippet(
        original,
        oldString,
        newString,
        inputBoolean(input, "replaceAll") ?? false,
      );
      return [fileDiff(path, original, updated)];
    }
  }

  // No file view: diff the snippet against its replacement. Line numbers refer
  // to the snippet, but the changed lines read exactly like the post-edit diff.
  return [fileDiff(label, oldString, newString)];
}

async function previewWrite(input: unknown, readFile?: PreviewFileReader): Promise<FileDiff[]> {
  const path = inputString(input, "path");
  const content = inputString(input, "content") ?? "";
  const label = path ?? "(unknown file)";

  const original = path && readFile ? await readFile(path) : undefined;
  return [
    fileDiff(label, original ?? "", content, { created: original === undefined }),
  ];
}

async function previewApplyPatch(
  input: unknown,
  readFile?: PreviewFileReader,
): Promise<FileDiff[]> {
  const patch = inputString(input, "patch");
  if (!patch) return [];
  // Without a reader only pure-creation patches can be previewed; previewPatch
  // throws for the rest, and the caller's catch turns that into "no diff".
  return await previewPatch(patch, readFile ?? (async () => undefined));
}
