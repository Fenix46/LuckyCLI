import { Box } from "../../vendor/ink-compat.js";
import React from "react";
import type { Theme } from "../themes.js";
import { Markdown } from "./Markdown.js";
import { findStableSplit } from "./stream-split.js";

interface StreamingMarkdownProps {
  text: string;
  theme: Theme;
}

/**
 * Render assistant markdown WHILE it streams.
 *
 * Ported from Claude Code's StreamingMarkdown. The text is split at the last
 * top-level block boundary (see findStableSplit): everything before is stable
 * and gets its own <Markdown>, which is React.memo'd on (text, theme) — so as
 * the unstable tail grows the stable prefix is a memo cache hit and never
 * re-parses. Only the small growing tail is re-parsed per delta, turning the
 * per-token cost from O(whole reply) into O(last block).
 *
 * The boundary only ever advances (monotonic), tracked in a ref. Because the
 * advance is idempotent for a given text, render-time ref mutation is safe.
 * The component unmounts when the turn ends (streaming text → null), which
 * resets the ref for the next turn.
 */
function StreamingMarkdownInner({ text, theme }: StreamingMarkdownProps): React.JSX.Element {
  const stablePrefixRef = React.useRef("");

  // Defensive: if the text was replaced rather than extended (shouldn't happen
  // mid-turn, but guards against a stale boundary), reset.
  if (!text.startsWith(stablePrefixRef.current)) {
    stablePrefixRef.current = "";
  }

  const boundary = findStableSplit(text);
  // Boundary only advances — never walk it backwards on a transient parse.
  if (boundary > stablePrefixRef.current.length) {
    stablePrefixRef.current = text.slice(0, boundary);
  }

  const stablePrefix = stablePrefixRef.current;
  const unstableSuffix = text.slice(stablePrefix.length);

  return (
    <Box flexDirection="column">
      {stablePrefix ? <Markdown text={stablePrefix} theme={theme} /> : null}
      {unstableSuffix ? <Markdown text={unstableSuffix} theme={theme} /> : null}
    </Box>
  );
}

export const StreamingMarkdown = StreamingMarkdownInner;
