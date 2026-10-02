import { Box, Text } from "../../vendor/ink-compat.js";
import React from "react";
import type { Theme } from "../themes.js";
import { parseMessageIntoBlocks, type Block } from "./parse.js";
import { highlightCodeLine, parseInlineMarkdown } from "./highlight.js";
import Table from "./Table.js";

// Context for passing theme to Table sub-components
const ThemeContext = React.createContext<Theme | null>(null);

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
          return renderMarkdownTable(block, blockIdx, theme);
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

/** Theme-adapted header component for the Table. */
function MarkdownHeader(props: React.PropsWithChildren<{}>) {
  const theme = React.useContext(ThemeContext);
  return (
    <Text bold color={theme?.text}>
      {props.children}
    </Text>
  );
}

/** Theme-adapted cell component for the Table. */
function MarkdownCell(props: React.PropsWithChildren<{}>) {
  return <Text Wrapped={true}>{props.children}</Text>;
}

/** Theme-adapted skeleton component for the Table borders. */
function MarkdownSkeleton(props: React.PropsWithChildren<{}>) {
    const theme = React.useContext(ThemeContext);
  return <Text color={theme?.subtle}>{props.children}</Text>;
}

/** Convert parsed table block to Table component data format and render. */
function renderMarkdownTable(block: Block, key: number, theme: Theme): React.JSX.Element {
  const rows = block.rows!;
  const colWidths = block.colWidths!;
  // rows[0] = header, rows[1] = separator, rows[2..] = body

  if (rows.length < 3) {
    // Not enough rows to render a meaningful table, fall back to paragraph
    return (
      <Box key={key}>
        <Text>{parseInlineMarkdown(rows[0]?.join(", ") ?? "", theme)}</Text>
      </Box>
    );
  }

  // Extract column names from header row (rows[0])
  const headers = rows[0]!;
  const columnKeys = headers.map((_, i) => `col_${i}`) as Array<`col_${number}`>;

  // Convert body rows (rows[2..]) to array of objects
  const data: Record<string, string | number | boolean | null | undefined>[] = [];
  for (let r = 2; r < rows.length; r++) {
    const rowData: Record<string, string | number | boolean | null | undefined> = {};
    const bodyRow = rows[r]!;
    for (let c = 0; c < columnKeys.length; c++) {
      rowData[columnKeys[c]!] = bodyRow[c] ?? "";
    }
    data.push(rowData);
  }

  return (
    <ThemeContext.Provider value={theme} key={key}>
      <Box flexDirection="column" marginTop={0} marginBottom={1}>
        <Table<Record<string, string | number | boolean | null | undefined>>
          data={data}
          columns={columnKeys}
          padding={1}
          header={MarkdownHeader}
          cell={MarkdownCell}
          skeleton={MarkdownSkeleton}
        />
      </Box>
    </ThemeContext.Provider>
  );
}

export const Markdown = React.memo(MarkdownInner);
