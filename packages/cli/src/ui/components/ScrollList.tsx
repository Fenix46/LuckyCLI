/**
 * A list that stays at most `maxRows` tall: long lists scroll in a window
 * that follows the selection, with "↑ N more" / "↓ N more" markers and the
 * cursor position so the user knows there is more to see. Shared by the slash
 * menu and the pickers so none of them floods the screen.
 */
import React from "react";
import { Box, Text } from "../../vendor/ink-compat.js";
import type { Theme } from "../themes.js";
import { listWindow } from "../lib/list-window.js";

export const SCROLL_LIST_MAX_ROWS = 8;

export function ScrollList({
  theme,
  count,
  selectedIndex,
  maxRows = SCROLL_LIST_MAX_ROWS,
  renderRow,
}: {
  theme: Theme;
  count: number;
  selectedIndex: number;
  maxRows?: number;
  renderRow: (index: number) => React.ReactNode;
}): React.JSX.Element {
  const { start, end, above, below } = listWindow(count, selectedIndex, maxRows);
  const scrolls = above > 0 || below > 0;
  return (
    <Box flexDirection="column">
      {scrolls ? (
        <Text color={theme.subtle}>{above > 0 ? `  ↑ ${above} more` : " "}</Text>
      ) : null}
      {Array.from({ length: end - start }, (_, offset) => renderRow(start + offset))}
      {scrolls ? (
        <Text color={theme.subtle}>
          {below > 0 ? `  ↓ ${below} more` : " "}
          {"   "}
          {`${selectedIndex + 1}/${count}`}
        </Text>
      ) : null}
    </Box>
  );
}
