import { Box, Text } from "../../vendor/ink-compat.js";
import { stringWidth } from "../../vendor/ink/stringWidth.js";
import React from "react";
import type { Theme } from "../themes.js";
import { parseMessageIntoBlocks, type Block } from "./parse.js";
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
            <Box key={blockIdx} flexDirection="column">
              <Box flexDirection="column" paddingLeft={2} paddingTop={1} paddingBottom={1} backgroundColor={theme.codeLabelBg}>
                <Text bold color={theme.accent}>
                  {block.language?.toUpperCase() || "CODE"}
                </Text>
              </Box>
              <Box flexDirection="column" backgroundColor={theme.codeBlockBg} paddingTop={1} paddingBottom={1}>
                {block.codeLines.map((line, lineIdx) => (
                  <Text key={lineIdx}>
                    <Text color={theme.muted}>  </Text>
                    {highlightCodeLine(line, block.language || "code", theme)}
                  </Text>
                ))}
              </Box>
            </Box>
          );
        }

        if (block.type === "header") {
          const level = block.level || 1;
          const icon = level === 1 ? "◆ " : level === 2 ? "▹ " : "• ";
          return (
            <Box key={blockIdx} flexDirection="column" marginTop={1}>
              <Text bold color={theme.primary}>
                {icon}
                {block.text}
              </Text>
            </Box>
          );
        }

        if (block.type === "list") {
          return (
            <Box key={blockIdx} paddingLeft={2}>
              <Text>
                {parseInlineMarkdown(block.text, theme)}
              </Text>
            </Box>
          );
        }

        if (block.type === "table" && block.rows && block.colWidths) {
          return renderTable(block, blockIdx, theme);
        }

        if (!block.text.trim()) {
          return <Box key={blockIdx} height={1} />;
        }

        return (
          <Box key={blockIdx}>
            <Text>
              {parseInlineMarkdown(block.text, theme)}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

/** Render a parsed markdown table block as Ink elements. */
function renderTable(block: Block, key: number, theme: Theme): React.JSX.Element {
  const rows = block.rows!;
  const colWidths = block.colWidths!;
  // rows[0] = header, rows[1] = separator, rows[2..] = body

  const cellPad = 1; // one space on each side of cell content

  // Build cell text with padding using stringWidth for correct wide-char handling.
  // Returns exactly (cellPad + width + cellPad) characters.
  function padCell(cell: string, width: number): string {
    const leftPad = " ".repeat(cellPad);
    const contentWidth = stringWidth(cell);
    const rightPad = cellPad + width - contentWidth;
    return leftPad + cell + " ".repeat(Math.max(0, rightPad));
  }

  // Build a full table row string (including borders)
  function rowBorder(charLeft: string, charMid: string, charRight: string, sep: string = charMid): string {
    const segments = colWidths.map((w) => charMid.repeat(cellPad + w + cellPad));
    return charLeft + segments.join(sep) + charRight;
  }

  function dataRow(
    cells: readonly string[],
    rowType: "header" | "body",
  ): React.JSX.Element {
    return (
      <Text>
        <Text color={theme.muted}>│</Text>
        {cells.map((c, i) => (
          <React.Fragment key={i}>
            <Text bold={rowType === "header"} color={rowType === "header" ? theme.accent : undefined}>
              {padCell(c, colWidths[i] ?? 0)}
            </Text>
            <Text color={theme.muted}>│</Text>
          </React.Fragment>
        ))}
      </Text>
    );
  }

  const lines: React.JSX.Element[] = [];
  let idx = 0;

  // Top border
  lines.push(
    <Text key={key + "-" + idx++} color={theme.muted}>
      {rowBorder("┌", "─", "┐", "┬")}
    </Text>,
  );

  // Header row (bold, accent color)
  lines.push(dataRow(rows[0]!, "header"));

  // Separator line
  lines.push(
    <Text key={key + "-" + idx++} color={theme.muted}>
      {rowBorder("├", "─", "┤", "┼")}
    </Text>,
  );

  // Body rows
  for (let r = 2; r < rows.length; r++) {
    lines.push(dataRow(rows[r]!, "body"));
    // Add separator after each body row except the last
    if (r < rows.length - 1) {
      lines.push(
        <Text key={key + "-" + idx++} color={theme.muted}>
          {rowBorder("├", "─", "┤", "┼")}
        </Text>,
      );
    }
  }

  // Bottom border with ┴ junctions at column boundaries
  lines.push(
    <Text key={key + "-" + idx++} color={theme.muted}>
      {"└" + colWidths.map((w) => "─".repeat(cellPad + w + cellPad)).join("┴") + "┘"}
    </Text>,
  );

  return (
    <Box key={key} flexDirection="column" marginTop={0} marginBottom={1}>
      {lines}
    </Box>
  );
}

export const Markdown = React.memo(MarkdownInner);
