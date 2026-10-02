/**
 * Slash-command completion menu. Sits just below the prompt; filtering and
 * selection state stay in App. Command names line up in a column so the
 * descriptions read as a second column.
 */
import React from "react";
import { Box } from "../../vendor/ink-compat.js";
import type { Theme } from "../themes.js";
import { OptionRow } from "./kit.js";

export function SlashMenu({
  theme,
  commands,
  selectedIndex,
}: {
  theme: Theme;
  commands: Array<{ name: string; desc: string }>;
  selectedIndex: number;
}): React.JSX.Element {
  const labelWidth = Math.max(12, ...commands.map((cmd) => cmd.name.length + 2));
  return (
    <Box flexDirection="column" paddingLeft={1} marginTop={1} width="100%">
      {commands.map((cmd, idx) => (
        <OptionRow
          key={cmd.name}
          theme={theme}
          selected={idx === selectedIndex}
          label={cmd.name}
          labelWidth={labelWidth}
          detail={cmd.desc}
        />
      ))}
    </Box>
  );
}
