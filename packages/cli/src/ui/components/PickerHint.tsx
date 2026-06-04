import { Box, Text } from "ink";
import React from "react";
import type { Theme } from "../themes.js";

export function PickerHint({
  theme,
  selectLabel = "select",
}: {
  theme: Theme;
  selectLabel?: string;
}): React.JSX.Element {
  return (
    <Box marginTop={0.5}>
      <Text color={theme.muted}>Up/Down to move · Enter to {selectLabel} · Esc to close</Text>
    </Box>
  );
}
