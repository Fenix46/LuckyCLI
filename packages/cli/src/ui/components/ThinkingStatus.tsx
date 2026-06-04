import { Text } from "ink";
import React from "react";
import type { Theme } from "../themes.js";

function ThinkingStatusInner({
  theme,
  elapsedSeconds,
  frame,
}: {
  theme: Theme;
  elapsedSeconds: number;
  frame: number;
}): React.JSX.Element {
  const frames = ["●", "●", "◆", "◆", "▲", "▲"];
  const pulse = frames[frame % frames.length] ?? "●";
  const dots = ".".repeat((frame % 3) + 1).padEnd(3, " ");
  return (
    <Text bold color={theme.success}>
      {pulse} lucky{" "}
      <Text color={theme.accent}>
        thinking{dots}
      </Text>{" "}
      <Text color="white">({elapsedSeconds}s)</Text>
    </Text>
  );
}

export const ThinkingStatus = React.memo(ThinkingStatusInner);
