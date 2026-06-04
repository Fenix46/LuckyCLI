import { Box, measureElement, type DOMElement } from "ink";
import React, { useEffect, useRef, useState } from "react";

/**
 * A fixed-height viewport that pins its content to the bottom (chat-style) and
 * can scroll back through it.
 *
 * Ink's `justifyContent="flex-end"` on an overflowing box misrenders in the
 * alternate screen (content overlaps), so instead we measure the content's
 * natural height and push it up with a negative top margin so its last lines
 * sit at the bottom edge; the outer `overflow="hidden"` clips whatever scrolls
 * past the top. `scrollUp` is the number of lines revealed above the bottom
 * (0 = stick to bottom), clamped to the content.
 *
 * `contentKey` must change whenever the rendered content's height can change
 * (new items, streaming text, resize) so the height is re-measured — otherwise
 * the measurement goes stale and scrollback (maxScroll) stays at 0.
 */
export function ScrollViewport({
  height,
  scrollUp = 0,
  contentKey,
  onMaxScrollChange,
  children,
}: {
  height: number;
  scrollUp?: number;
  contentKey: string | number;
  /** Reports the max lines that can be scrolled up, so callers can clamp. */
  onMaxScrollChange?: (max: number) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const contentRef = useRef<DOMElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  // Re-measure whenever the content or available height changes. measureElement
  // must run after layout (in an effect), not during render.
  useEffect(() => {
    if (!contentRef.current) return;
    const measured = measureElement(contentRef.current);
    setContentHeight(measured.height);
  }, [contentKey, height]);

  const overflow = Math.max(0, contentHeight - height);
  const maxScroll = overflow;
  const clampedScroll = Math.min(Math.max(0, scrollUp), maxScroll);
  // Pin to bottom (offset = overflow), then reveal `clampedScroll` lines above.
  const offset = overflow - clampedScroll;

  useEffect(() => {
    onMaxScrollChange?.(maxScroll);
  }, [maxScroll, onMaxScrollChange]);

  return (
    <Box height={height} flexDirection="column" overflow="hidden" flexShrink={0}>
      {/* Measured content box: natural height (no height constraint, no shrink)
          so measureElement reports the true content height even when it exceeds
          the viewport. The negative margin scrolls it; the parent clips. */}
      <Box ref={contentRef} flexDirection="column" flexShrink={0} marginTop={-offset}>
        {children}
      </Box>
    </Box>
  );
}
