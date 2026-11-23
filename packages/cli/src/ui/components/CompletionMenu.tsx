/**
 * Argument completion menu. Sits below the prompt like the slash menu, but
 * lists the values for the current token (theme ids, model names, skills, MCP
 * servers). Filtering and key handling live in App.
 */
import React from "react";
import { Box, Text } from "../../vendor/ink-compat.js";
import type { Theme } from "../themes.js";
import type { Completion } from "../lib/completions.js";
import { GLYPH } from "./kit.js";
import { ScrollList, SCROLL_LIST_MAX_ROWS } from "./ScrollList.js";

export function CompletionMenu({
  theme,
  items,
  selectedIndex,
  width,
  hint,
  maxRows = SCROLL_LIST_MAX_ROWS,
}: {
  theme: Theme;
  items: Completion[];
  selectedIndex: number;
  width?: number;
  hint?: string;
  maxRows?: number;
}): React.JSX.Element {
  const valueWidth = Math.max(8, ...items.map((item) => item.value.length));
  const descWidth = Math.max(8, (width ?? 96) - valueWidth - 6);
  return (
    <Box flexDirection="column" paddingLeft={1} marginTop={1} width="100%">
      <ScrollList
        theme={theme}
        count={items.length}
        selectedIndex={selectedIndex}
        maxRows={maxRows}
        renderRow={(idx) => {
          const item = items[idx]!;
          const selected = idx === selectedIndex;
          return (
            <Box key={item.value} flexDirection="row">
              <Text color={theme.accent}>{selected ? `${GLYPH.cursor} ` : "  "}</Text>
              <Text bold={selected} color={selected ? theme.accent : theme.text}>
                {item.value.padEnd(valueWidth)}
              </Text>
              {item.description ? (
                <Text color={theme.muted} wrap="truncate-end">
                  {`  ${item.description.length > descWidth ? `${item.description.slice(0, descWidth - 1)}…` : item.description}`}
                </Text>
              ) : null}
            </Box>
          );
        }}
      />
      {hint ? <Text color={theme.subtle}>{`  ${hint}`}</Text> : null}
    </Box>
  );
}
