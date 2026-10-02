import { Box, Text, stringWidth } from "../../vendor/ink-compat.js";
import React from "react";
import type { Theme } from "../themes.js";
import { layoutTable } from "./table-layout.js";

const pad = (text: string, width: number): string => text + " ".repeat(Math.max(0, width - stringWidth(text)));

/**
 * A markdown table sized to the space it has (see layoutTable): a bordered
 * grid with wrapped cells when it fits, stacked "header: value" records when
 * the terminal is too narrow for the columns.
 */
export function MarkdownTable({
  headers,
  rows,
  width,
  theme,
}: {
  headers: string[];
  rows: string[][];
  width: number;
  theme: Theme;
}): React.JSX.Element {
  const layout = layoutTable(headers, rows, width);

  if (layout.kind === "stacked") {
    const labelWidth = Math.min(
      Math.max(...layout.headers.map((h) => stringWidth(h))),
      Math.max(6, Math.floor(width / 3)),
    );
    return (
      <Box flexDirection="column" marginBottom={1}>
        {layout.rows.map((row, r) => (
          <Box key={r} flexDirection="column" marginTop={r === 0 ? 0 : 1}>
            {layout.headers.map((header, c) => (
              <Box key={c} flexDirection="row">
                <Box width={labelWidth + 2} flexShrink={0}>
                  <Text bold color={theme.muted} wrap="truncate-end">
                    {header}
                  </Text>
                </Box>
                <Box flexShrink={1}>
                  <Text color={theme.text}>{row[c]}</Text>
                </Box>
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    );
  }

  const { widths } = layout;
  const rule = (left: string, cross: string, right: string) => (
    <Text color={theme.subtle}>
      {left}
      {widths.map((w) => "─".repeat(w + 2)).join(cross)}
      {right}
    </Text>
  );
  const line = (cells: string[][], bold: boolean, key: string) => {
    const height = Math.max(...cells.map((cell) => cell.length));
    return Array.from({ length: height }, (_, i) => (
      <Text key={`${key}-${i}`}>
        {cells.map((cell, c) => (
          <React.Fragment key={c}>
            <Text color={theme.subtle}>{"│ "}</Text>
            <Text bold={bold} color={theme.text}>
              {pad(cell[i] ?? "", widths[c]!)}
            </Text>
            <Text> </Text>
          </React.Fragment>
        ))}
        <Text color={theme.subtle}>│</Text>
      </Text>
    ));
  };

  return (
    <Box flexDirection="column" marginBottom={1}>
      {rule("╭", "┬", "╮")}
      {line(layout.header, true, "head")}
      {layout.rows.map((row, r) => (
        <React.Fragment key={r}>
          {rule("├", "┼", "┤")}
          {line(row, false, `row-${r}`)}
        </React.Fragment>
      ))}
      {rule("╰", "┴", "╯")}
    </Box>
  );
}
