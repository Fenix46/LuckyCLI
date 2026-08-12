/**
 * Host-backed file access for the file tools.
 *
 * A host (e.g. the ACP server fronting an editor) can hand tools a view of
 * files the disk doesn't have yet — unsaved editor buffers — and a write path
 * that lands edits in those buffers. Tools call these helpers instead of
 * node:fs directly; with no overrides configured they are plain disk access,
 * so the default behavior is unchanged.
 *
 * Overrides always receive an absolute path that already passed the cwd
 * sandbox checks. A host that has no view of the file (or fails) falls back
 * to disk transparently: an editor knowing nothing about a path must never
 * make it unreadable.
 */
import { readFile, writeFile } from "node:fs/promises";
import type { ToolContext } from "./types.js";

/** Read UTF-8 text via the host override when available, else from disk. */
export async function readTextViaContext(ctx: ToolContext, absPath: string): Promise<string> {
  if (ctx.readTextFile) {
    try {
      const hosted = await ctx.readTextFile(absPath);
      if (hosted !== null) return hosted;
    } catch {
      // Host failure → disk fallback.
    }
  }
  return readFile(absPath, "utf8");
}

/**
 * Like {@link readTextViaContext} but resolves undefined for a missing file
 * (used where "does not exist yet" is a valid state, e.g. write_file capturing
 * the previous contents for its diff).
 */
export async function tryReadTextViaContext(
  ctx: ToolContext,
  absPath: string,
): Promise<string | undefined> {
  try {
    return await readTextViaContext(ctx, absPath);
  } catch {
    return undefined;
  }
}

/** Write UTF-8 text via the host override when available, else to disk. */
export async function writeTextViaContext(
  ctx: ToolContext,
  absPath: string,
  content: string,
): Promise<void> {
  if (ctx.writeTextFile) {
    try {
      await ctx.writeTextFile(absPath, content);
      return;
    } catch {
      // Host failure → disk fallback, so the edit is never silently lost.
    }
  }
  await writeFile(absPath, content, "utf8");
}
