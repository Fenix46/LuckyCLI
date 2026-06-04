import { Box, Text } from "ink";
import React from "react";
import type { Theme } from "../themes.js";
import { stripInlineMarkdown } from "../lib/format.js";

/**
 * The live, transient preview of the assistant reply while it streams.
 *
 * Rendered as a small block of plain dimmed lines (markdown syntax stripped,
 * no per-block margins), so its height is bounded and predictable. The full,
 * rich-markdown version lands in <Static> once the turn finalizes — keeping the
 * live region from ever growing past the viewport and getting "frozen" into the
 * scrollback above the final message.
 */
function StreamingPreviewInner({
  text,
  theme,
  width,
}: {
  text: string;
  theme: Theme;
  width: number;
}): React.JSX.Element {
  const lines = text.split("\n").map((line) => stripInlineMarkdown(line));
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Text key={index} color={theme.muted} wrap="truncate-end">
          {truncate(line, Math.max(8, width))}
        </Text>
      ))}
    </Box>
  );
}

function truncate(line: string, max: number): string {
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export const StreamingPreview = React.memo(StreamingPreviewInner);
