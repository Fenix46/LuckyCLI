import { Box, Text } from "../../vendor/ink-compat.js";
import React from "react";
import type { Theme } from "../themes.js";
import { parseMessageIntoBlocks, type Block } from "./parse.js";
import { highlightCodeLine, parseInlineMarkdown } from "./highlight.js";
import { MarkdownTable } from "./MarkdownTable.js";

interface MarkdownProps {
  text: string;
  theme: Theme;
  /** Columns available to the reply; tables reflow to fit it. */
  width: number;
}

/**
 * Render assistant markdown to Ink elements.
 *
 * Wrapped in React.memo and keyed on (text, theme): the heavy block parsing and
 * per-line syntax highlighting only run when the text or theme actually change.
 * This matters on the streaming hot path — re-renders driven by the thinking
 * animation or unrelated state no longer re-parse the live preview.
 */
function MarkdownInner({ text, theme, width }: MarkdownProps): React.JSX.Element {
  const blocks = parseMessageIntoBlocks(text);

  return (
    <Box flexDirection="column">
      {blocks.map((block, blockIdx) => {
        if (block.type === "code" && block.codeLines) {
          return (
            <Box key={blockIdx} flexDirection="column" width="100%" marginY={1} backgroundColor={theme.codeBlockBg}>
              <Text color={theme.muted}>{"  "}{block.language?.toLowerCase() || "code"}</Text>
              {block.codeLines.map((line, lineIdx) => (
                <Text key={lineIdx} color={theme.text}>
                  {"  "}
                  {highlightCodeLine(line, block.language || "code", theme)}
                </Text>
              ))}
            </Box>
          );
        }

        if (block.type === "header") {
          const level = block.level || 1;
          return (
            <Box key={blockIdx} flexDirection="column" marginTop={1}>
              <Text bold underline={level === 1} color={level >= 3 ? theme.muted : theme.text}>
                {block.text}
              </Text>
            </Box>
          );
        }

        if (block.type === "list") {
          // Hanging indent: wrapped lines align with the item text, not the
          // bullet. Unordered markers become a muted dot.
          const match = /^(\s*)((?:[-*+])|\d+[.)])\s+(.*)$/.exec(block.text);
          const indent = match?.[1]?.length ?? 0;
          const rawMarker = match?.[2] ?? "-";
          const marker = /^\d/.test(rawMarker) ? rawMarker : "•";
          return (
            <Box key={blockIdx} flexDirection="row" paddingLeft={Math.min(8, indent) + 1}>
              <Box width={marker.length + 1} flexShrink={0}>
                <Text color={theme.muted}>{marker}</Text>
              </Box>
              <Box flexShrink={1}>
                <Text color={theme.text}>{parseInlineMarkdown(match?.[3] ?? block.text, theme)}</Text>
              </Box>
            </Box>
          );
        }

        if (block.type === "table" && block.rows && block.colWidths) {
          return renderMarkdownTable(block, blockIdx, theme, width);
        }

        if (!block.text.trim()) {
          // A code block already brings its own margin: a blank line next to
          // it would double the gap.
          if (blocks[blockIdx - 1]?.type === "code" || blocks[blockIdx + 1]?.type === "code") return null;
          return <Box key={blockIdx} height={1} />;
        }

        return (
          <Box key={blockIdx}>
            <Text color={theme.text}>
              {parseInlineMarkdown(block.text, theme)}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

/** Render a parsed table block, reflowed to the available width. */
function renderMarkdownTable(block: Block, key: number, theme: Theme, width: number): React.JSX.Element {
  const rows = block.rows!;
  // rows[0] = header, rows[1] = separator, rows[2..] = body

  if (rows.length < 3) {
    // Not enough rows to render a meaningful table, fall back to paragraph
    return (
      <Box key={key}>
        <Text>{parseInlineMarkdown(rows[0]?.join(", ") ?? "", theme)}</Text>
      </Box>
    );
  }

  return <MarkdownTable key={key} headers={rows[0]!} rows={rows.slice(2)} width={width} theme={theme} />;
}

export const Markdown = React.memo(MarkdownInner);
