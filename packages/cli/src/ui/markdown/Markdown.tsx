import { Box, Text } from "../../vendor/ink-compat.js";
import React from "react";
import type { Theme } from "../themes.js";
import { parseMessageIntoBlocks } from "./parse.js";
import { highlightCodeLine, parseInlineMarkdown } from "./highlight.js";

interface MarkdownProps {
  text: string;
  theme: Theme;
}

/**
 * Render assistant markdown to Ink elements.
 *
 * Wrapped in React.memo and keyed on (text, theme): the heavy block parsing and
 * per-line syntax highlighting only run when the text or theme actually change.
 * This matters on the streaming hot path — re-renders driven by the thinking
 * animation or unrelated state no longer re-parse the live preview.
 */
function MarkdownInner({ text, theme }: MarkdownProps): React.JSX.Element {
  const blocks = parseMessageIntoBlocks(text);

  return (
    <Box flexDirection="column">
      {blocks.map((block, blockIdx) => {
        if (block.type === "code" && block.codeLines) {
          return (
            <Box key={blockIdx} flexDirection="column" marginY={0.5} paddingLeft={2}>
              <Box marginBottom={0.2}>
                <Text bold dimColor color={theme.accent}>
                  ⌨ {block.language?.toUpperCase() || "CODE"}
                </Text>
              </Box>
              <Box flexDirection="column">
                {block.codeLines.map((line, lineIdx) => (
                  <Text key={lineIdx}>
                    {highlightCodeLine(line, block.language || "code", theme)}
                  </Text>
                ))}
              </Box>
            </Box>
          );
        }

        if (block.type === "header") {
          const headerPrefix = "#".repeat(block.level || 1) + " ";
          return (
            <Box key={blockIdx} marginY={0.5}>
              <Text bold underline color={theme.primary}>
                {headerPrefix}
                {block.text}
              </Text>
            </Box>
          );
        }

        if (block.type === "list") {
          return (
            <Box key={blockIdx} paddingLeft={2} marginY={0.1}>
              <Text>
                {parseInlineMarkdown(block.text, theme)}
              </Text>
            </Box>
          );
        }

        if (!block.text.trim()) {
          return <Box key={blockIdx} height={0.5} />;
        }

        return (
          <Box key={blockIdx} marginY={0.2}>
            <Text>
              {parseInlineMarkdown(block.text, theme)}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

export const Markdown = React.memo(MarkdownInner);
