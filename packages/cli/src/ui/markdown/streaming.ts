/**
 * Bound the live streaming preview to its tail. The full message is rendered
 * (with rich markdown) once it finalizes into a <Static> item, so the live
 * region only needs the most recent output — keeping each re-render cheap no
 * matter how large the reply grows. Cut on a line boundary to avoid a partial
 * first line.
 */
const STREAMING_TAIL_CHARS = 8_000;

/**
 * How many trailing lines the *live* preview shows. This must stay small enough
 * that the dynamic region never exceeds the viewport height: Ink can only
 * redraw lines still on screen, so anything taller gets flushed permanently
 * into the scrollback — which is what made the live (tail-capped) text appear
 * "frozen and truncated" right above the full finalized message. Keeping the
 * preview to a handful of lines avoids that overlap; the complete reply still
 * lands in <Static> once the turn ends.
 */
const PREVIEW_TAIL_LINES = 6;

export function capStreamingTail(text: string): string {
  if (text.length <= STREAMING_TAIL_CHARS) return text;
  const tail = text.slice(text.length - STREAMING_TAIL_CHARS);
  const nl = tail.indexOf("\n");
  return nl >= 0 ? tail.slice(nl + 1) : tail;
}

/**
 * The text fed to the live markdown preview: the last few lines of the buffer,
 * bounded by both characters and lines. Trailing blank lines are dropped so the
 * preview box doesn't grow with empty padding. The full message still lands in
 * <Static> with complete markdown once it finalizes.
 */
export function streamingTail(text: string, maxLines: number = PREVIEW_TAIL_LINES): string {
  const capped = capStreamingTail(text);
  // Drop trailing blank lines: they'd otherwise inflate the preview height for
  // no visible content and push the box past the viewport.
  const lines = capped.replace(/\n+$/, "").split("\n");
  if (lines.length <= maxLines) return lines.join("\n");
  return lines.slice(lines.length - maxLines).join("\n");
}
