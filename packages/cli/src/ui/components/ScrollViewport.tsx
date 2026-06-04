import { Box, measureElement, type DOMElement } from "ink";
import React, { useLayoutEffect, useRef, useState } from "react";

/**
 * A fixed-height viewport that pins its content to the bottom (chat-style).
 *
 * Ink's `justifyContent="flex-end"` on an overflowing box misrenders in the
 * alternate screen (content overlaps), so instead we measure the content
 * height and push it up by a negative top margin so its last lines sit at the
 * bottom edge; the parent's `overflow="hidden"` clips whatever scrolls past the
 * top. `scrollUp` is the number of lines to reveal above the bottom (0 = stick
 * to bottom), clamped to the content.
 */
export function ScrollViewport({
  height,
  scrollUp = 0,
  onMaxScrollChange,
  children,
}: {
  height: number;
  scrollUp?: number;
  /** Reports the max lines that can be scrolled up, so callers can clamp. */
  onMaxScrollChange?: (max: number) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const contentRef = useRef<DOMElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  useLayoutEffect(() => {
    if (!contentRef.current) return;
    const measured = measureElement(contentRef.current);
    if (measured.height !== contentHeight) setContentHeight(measured.height);
  });

  const overflow = Math.max(0, contentHeight - height);
  const maxScroll = overflow;
  const clampedScroll = Math.min(Math.max(0, scrollUp), maxScroll);
  // Pin to bottom (offset = overflow), then reveal `clampedScroll` lines above.
  const offset = overflow - clampedScroll;

  useLayoutEffect(() => {
    onMaxScrollChange?.(maxScroll);
  }, [maxScroll, onMaxScrollChange]);

  return (
    <Box height={height} flexDirection="column" overflow="hidden">
      <Box ref={contentRef} flexDirection="column" flexShrink={0} marginTop={-offset}>
        {children}
      </Box>
    </Box>
  );
}
