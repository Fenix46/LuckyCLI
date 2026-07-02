/**
 * Slash-command completion menu, extracted from App.tsx's render (the deferred
 * follow-up in APP_REFACTOR_PLAN.md). Sits just below the prompt (Claude Code
 * style); filtering/selection state stays in App.
 */
import React from "react";
import { Box, Text } from "../../vendor/ink-compat.js";
import type { Theme } from "../themes.js";

export function SlashMenu({
  theme,
  commands,
  selectedIndex,
}: {
  theme: Theme;
  commands: Array<{ name: string; desc: string }>;
  selectedIndex: number;
}): React.JSX.Element {
  return (
    <Box flexDirection="column" paddingLeft={2} marginTop={1} width="100%">
      {commands.map((cmd, idx) => (
        <Box key={cmd.name} flexDirection="row">
          <Text color={idx === selectedIndex ? theme.accent : "gray"}>
            {idx === selectedIndex ? "❯ " : "  "}
          </Text>
          <Text bold color={idx === selectedIndex ? theme.primary : "white"}>
            {cmd.name.padEnd(12)}
          </Text>
          <Text color={idx === selectedIndex ? "white" : theme.muted}>{cmd.desc}</Text>
        </Box>
      ))}
    </Box>
  );
}
