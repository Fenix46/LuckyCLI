import { Box, Text } from "../../vendor/ink-compat.js";
import React from "react";
import type { Theme } from "../themes.js";
import { Markdown } from "../markdown/Markdown.js";

/**
 * The live assistant message while the reply streams.
 *
 * Rendered as a single block with one "lucky" header — identical to the
 * finalized transcript item (see ItemView's "assistant" case) — so the message
 * does not jump or re-print its header when the turn ends and it moves into the
 * transcript. In the alternate screen the viewport clips its top, so the reply
 * can stream at full height without overflowing or duplicating.
 */
function StreamingPreviewInner({
  text,
  theme,
}: {
  text: string;
  theme: Theme;
}): React.JSX.Element {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row">
        <Text bold color={theme.success}>● lucky</Text>
        <Text color={theme.muted}> › </Text>
      </Box>
      <Box paddingLeft={2}>
        <Markdown text={text} theme={theme} />
      </Box>
    </Box>
  );
}

export const StreamingPreview = React.memo(StreamingPreviewInner);
