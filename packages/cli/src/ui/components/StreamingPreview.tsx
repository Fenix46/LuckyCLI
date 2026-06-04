import { Box, Text } from "ink";
import React from "react";
import type { Theme } from "../themes.js";
import { Markdown } from "../markdown/Markdown.js";

/**
 * The live assistant message while the reply streams.
 *
 * Rendered as a single block with one "lucky" header — identical to the
 * finalized transcript item (see ItemView's "assistant" case) — so the message
 * does not jump or re-print its header when the turn ends and it moves into
 * <Static>. The whole current narration grows here in real time.
 *
 * `maxLines` bounds the height: only the last N source lines are shown so the
 * dynamic region never exceeds the viewport. On stock Ink, a dynamic region
 * taller than the terminal gets flushed permanently into the scrollback and
 * then duplicated by the finalized <Static> item — capping the source lines
 * avoids that. A "… earlier output above" marker hints when content scrolled
 * off the top. (Rendered markdown can still add a little block spacing, so the
 * cap is intentionally a few lines under the real height.)
 */
function StreamingPreviewInner({
  text,
  theme,
  maxLines,
}: {
  text: string;
  theme: Theme;
  maxLines?: number;
}): React.JSX.Element {
  let body = text;
  let truncated = false;
  if (maxLines !== undefined) {
    const lines = text.split("\n");
    if (lines.length > maxLines) {
      body = lines.slice(lines.length - maxLines).join("\n");
      truncated = true;
    }
  }

  return (
    <Box flexDirection="column" marginY={0.2}>
      <Box flexDirection="row" marginBottom={0.1}>
        <Text bold color={theme.success}>● lucky</Text>
        <Text color={theme.muted}> › </Text>
      </Box>
      {truncated ? (
        <Box paddingLeft={2}>
          <Text color={theme.muted} dimColor>… earlier output above</Text>
        </Box>
      ) : null}
      <Box paddingLeft={2}>
        <Markdown text={body} theme={theme} />
      </Box>
    </Box>
  );
}

export const StreamingPreview = React.memo(StreamingPreviewInner);
