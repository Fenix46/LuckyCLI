/**
 * Streaming markdown helpers.
 *
 * The live reply is split into a *stable* prefix (all top-level blocks that are
 * already finished) and an *unstable* suffix (only the final block, still being
 * written). The stable prefix is rendered once and committed permanently; only
 * the small unstable suffix re-parses on each delta. This keeps the live region
 * bounded — it never grows past the viewport and gets "frozen" into the
 * scrollback — while still streaming the full reply with rich markdown.
 *
 * Boundaries are top-level block separators: a blank line, or the close of a
 * fenced code block. An unterminated code fence keeps the whole fence in the
 * unstable suffix until its closing ``` arrives, so we never commit a half-open
 * block to the stable prefix.
 */
export interface StreamSplit {
  /** Finished blocks, safe to render once and keep. */
  stable: string;
  /** The final, still-growing block. */
  unstable: string;
}

/**
 * Find the boundary between finished blocks and the final growing block.
 *
 * `from` is a known-good lower bound for the boundary (the previously committed
 * stable length): scanning starts there so the cost is O(new text), not
 * O(whole reply). The returned boundary is always >= `from`.
 */
export function streamBoundary(text: string, from = 0): number {
  const lines = text.split("\n");

  // Walk lines tracking byte offsets and code-fence state. Record the offset
  // just after the last *completed* block separator that sits at or beyond
  // `from`. A separator is a blank line outside a code block, or the line that
  // closes a fence.
  let offset = 0;
  let boundary = 0;
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const lineLen = line.length + 1; // include the "\n"
    const isLast = i === lines.length - 1;
    const fenceToggle = line.trim().startsWith("```");

    if (fenceToggle) {
      if (inFence) {
        // Closing fence: the block ends after this line.
        inFence = false;
        if (!isLast) boundary = offset + lineLen;
      } else {
        inFence = true;
      }
    } else if (!inFence && line.trim() === "" && !isLast) {
      // Blank line outside a fence ends the preceding block.
      boundary = offset + lineLen;
    }

    offset += lineLen;
  }

  return Math.max(from, boundary);
}

/** Split streaming text into a stable prefix and an unstable (growing) suffix. */
export function splitStreaming(text: string, from = 0): StreamSplit {
  const boundary = streamBoundary(text, from);
  return {
    stable: text.slice(0, boundary),
    unstable: text.slice(boundary),
  };
}
