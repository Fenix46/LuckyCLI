/**
 * Slash-command completion menu. Sits just below the prompt; filtering and
 * selection state stay in App. Each row shows the command with the typed part
 * emphasized, a category badge (built-in / skill / markdown / MCP prompt) and
 * the description in a second column. The list scrolls in a fixed window so it
 * never floods the screen.
 */
import React from "react";
import { Box, Text } from "../../vendor/ink-compat.js";
import type { CommandCategory } from "../commands/types.js";
import type { Theme } from "../themes.js";
import { truncateSingleLine } from "../lib/format.js";
import { GLYPH } from "./kit.js";
import { ScrollList, SCROLL_LIST_MAX_ROWS } from "./ScrollList.js";

const BADGES: Record<CommandCategory, string> = {
  builtin: "",
  skill: "[skill]",
  command: "[cmd]",
  mcp: "[mcp]",
};

function categoryColor(theme: Theme, category: CommandCategory): string {
  switch (category) {
    case "skill":
      return theme.primary;
    case "command":
      return theme.accent;
    case "mcp":
      return theme.warning;
    default:
      return theme.text;
  }
}

export function SlashMenu({
  theme,
  commands,
  selectedIndex,
  query = "",
  width,
  hint,
  maxRows = SCROLL_LIST_MAX_ROWS,
}: {
  theme: Theme;
  commands: Array<{ name: string; desc: string; category?: CommandCategory; matchPositions?: number[] }>;
  selectedIndex: number;
  /** Text typed after the slash; used only when positions are not provided. */
  query?: string;
  /** Available row width, so the description truncates instead of wrapping. */
  width?: number;
  /** Key legend shown under the list. */
  hint?: string;
  maxRows?: number;
}): React.JSX.Element {
  const labelWidth = Math.max(12, ...commands.map((cmd) => cmd.name.length + 2));
  const badgeWidth = Math.max(0, ...commands.map((cmd) => BADGES[cmd.category ?? "builtin"].length + 2));
  const descWidth = Math.max(8, (width ?? 96) - labelWidth - badgeWidth - 4);
  const normalizedQuery = query.toLowerCase();

  return (
    <Box flexDirection="column" paddingLeft={1} marginTop={1} width="100%">
      <ScrollList
        theme={theme}
        count={commands.length}
        selectedIndex={selectedIndex}
        maxRows={maxRows}
        renderRow={(idx) => {
          const cmd = commands[idx]!;
          const selected = idx === selectedIndex;
          const category = cmd.category ?? "builtin";
          const color = categoryColor(theme, category);
          const name = cmd.name.slice(1);
          const padded = name.padEnd(Math.max(0, labelWidth - 1));
          const fallback = normalizedQuery && name.toLowerCase().startsWith(normalizedQuery)
            ? Array.from({ length: normalizedQuery.length }, (_, index) => index)
            : [];
          const highlighted = new Set(cmd.matchPositions ?? fallback);
          const badge = BADGES[category];
          return (
            <Box key={cmd.name} flexDirection="row">
              <Text color={theme.accent}>{selected ? `${GLYPH.cursor} ` : "  "}</Text>
              <Text bold={selected} color={theme.primary}>
                /
              </Text>
              <Text bold={selected} color={color}>
                {padded.split("").map((char, index) =>
                  highlighted.has(index) ? (
                    <Text key={index} bold underline>
                      {char}
                    </Text>
                  ) : (
                    char
                  ),
                )}
              </Text>
              <Text color={theme.muted} wrap="truncate-end">
                {`  ${truncateSingleLine(cmd.desc, descWidth)}`}
              </Text>
              {badge ? <Text color={color}>{`  ${badge}`}</Text> : null}
            </Box>
          );
        }}
      />
      {hint ? <Text color={theme.subtle}>{`  ${hint}`}</Text> : null}
    </Box>
  );
}
