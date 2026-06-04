/**
 * Bound the live streaming preview to its tail. The full message is rendered
 * (with rich markdown) once it finalizes into a <Static> item, so the live
 * region only needs the most recent output — keeping each re-render cheap no
 * matter how large the reply grows. Cut on a line boundary to avoid a partial
 * first line.
 */
const STREAMING_TAIL_CHARS = 8_000;
const STREAMING_TAIL_LINES = 40;

export function capStreamingTail(text: string): string {
  if (text.length <= STREAMING_TAIL_CHARS) return text;
  const tail = text.slice(text.length - STREAMING_TAIL_CHARS);
  const nl = tail.indexOf("\n");
  return nl >= 0 ? tail.slice(nl + 1) : tail;
}

/**
 * The text fed to the live markdown preview: the tail of the buffer, bounded by
 * both characters and lines. This keeps each streaming re-render O(viewport)
 * rather than O(whole reply) — the full message still lands in <Static> with
 * complete markdown once it finalizes.
 */
export function streamingTail(text: string): string {
  const capped = capStreamingTail(text);
  const lines = capped.split("\n");
  if (lines.length <= STREAMING_TAIL_LINES) return capped;
  return lines.slice(lines.length - STREAMING_TAIL_LINES).join("\n");
}
