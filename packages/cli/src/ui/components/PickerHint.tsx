import { Box, Text } from "../../vendor/ink-compat.js";
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
    <Box marginTop={1}>
      <Text color={theme.muted} dimColor>↑↓ move · enter {selectLabel} · esc close</Text>
    </Box>
  );
}
