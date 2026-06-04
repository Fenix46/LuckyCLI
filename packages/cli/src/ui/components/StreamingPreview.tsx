import { Box } from "ink";
import React from "react";
import type { Theme } from "../themes.js";
import { Markdown } from "../markdown/Markdown.js";

/**
 * The live, transient tail of the assistant reply while it streams.
 *
 * The turn-runner commits each finished markdown block into the transcript
 * (<Static>) as it stabilizes, so this only ever renders the final, still-
 * growing block. That keeps the dynamic region small — it never grows past the
 * viewport and gets "frozen" into the scrollback — while the reply still
 * streams live with full rich markdown.
 */
function StreamingPreviewInner({
  text,
  theme,
}: {
  text: string;
  theme: Theme;
}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Markdown text={text} theme={theme} />
    </Box>
  );
}

export const StreamingPreview = React.memo(StreamingPreviewInner);
