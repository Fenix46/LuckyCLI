/**
 * Find the stable/unstable split point for streaming markdown.
 *
 * Ported from Claude Code's StreamingMarkdown (which splits at the last
 * top-level block boundary so everything before is final and only the growing
 * final block is re-parsed per delta). Our parser is line-based
 * (parseMessageIntoBlocks), so the safe boundary is the last blank line that is
 * NOT inside an open code fence: every block above it is top-level complete and
 * will never change, while the text below it is the block still being streamed.
 *
 * Returns the character index at which to split `text`. Everything before is
 * stable; everything from the index on is the unstable tail.
 */
export function findStableSplit(text: string): number {
  const lines = text.split("\n");

  // Walk lines tracking code-fence depth. Record the offset just past the most
  // recent blank line seen while NOT inside a fence — that is the latest safe
  // boundary. We never split inside a fence: an unclosed fence is a single
  // growing block that must stay whole.
  let offset = 0;
  let inFence = false;
  let lastSafeBoundary = 0;

  // Don't treat the very last line as a boundary source — it's still growing.
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i]!;
    const lineWithNewline = line.length + 1; // +1 for the "\n" that split removed

    if (line.trim().startsWith("```")) {
      inFence = !inFence;
    } else if (!inFence && line.trim() === "") {
      // Boundary is just past this blank line.
      lastSafeBoundary = offset + lineWithNewline;
    }

    offset += lineWithNewline;
  }

  return lastSafeBoundary;
}
