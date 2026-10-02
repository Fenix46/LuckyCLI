/**
 * Slash-command completion menu. Sits just below the prompt; filtering and
 * selection state stay in App. Command names line up in a column so the
 * descriptions read as a second column. Long lists scroll in a fixed-height
 * window that follows the selection, so the menu never floods the screen.
 */
import React from "react";
import { Box } from "../../vendor/ink-compat.js";
import type { Theme } from "../themes.js";
import { OptionRow } from "./kit.js";
import { ScrollList, SCROLL_LIST_MAX_ROWS } from "./ScrollList.js";

export function SlashMenu({
  theme,
  commands,
  selectedIndex,
  maxRows = SCROLL_LIST_MAX_ROWS,
}: {
  theme: Theme;
  commands: Array<{ name: string; desc: string }>;
  selectedIndex: number;
  maxRows?: number;
}): React.JSX.Element {
  const labelWidth = Math.max(12, ...commands.map((cmd) => cmd.name.length + 2));
  return (
    <Box flexDirection="column" paddingLeft={1} marginTop={1} width="100%">
      <ScrollList
        theme={theme}
        count={commands.length}
        selectedIndex={selectedIndex}
        maxRows={maxRows}
        renderRow={(idx) => {
          const cmd = commands[idx]!;
          return (
            <OptionRow
              key={cmd.name}
              theme={theme}
              selected={idx === selectedIndex}
              label={cmd.name}
              labelWidth={labelWidth}
              detail={cmd.desc}
            />
          );
        }}
      />
    </Box>
  );
}
