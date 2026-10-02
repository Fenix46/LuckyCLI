import React from "react";
import type { Theme } from "../themes.js";
import { KeyHints } from "./kit.js";

export function PickerHint({
  theme,
  selectLabel = "select",
}: {
  theme: Theme;
  selectLabel?: string;
}): React.JSX.Element {
  return (
    <KeyHints
      theme={theme}
      hints={[
        ["↑↓", "move"],
        ["enter", selectLabel],
        ["esc", "close"],
      ]}
    />
  );
}
