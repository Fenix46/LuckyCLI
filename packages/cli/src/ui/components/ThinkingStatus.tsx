import { Text } from "../../vendor/ink-compat.js";
import React from "react";
import type { Theme } from "../themes.js";

function ThinkingStatusInner({
  theme,
  elapsedSeconds,
  frame,
  reasoning,
}: {
  theme: Theme;
  elapsedSeconds: number;
  frame: number;
  reasoning?: boolean;
}): React.JSX.Element {
  const frames = ["●", "●", "◆", "◆", "▲", "▲"];
  const pulse = frames[frame % frames.length] ?? "●";
  const dots = ".".repeat((frame % 3) + 1).padEnd(3, " ");
  // Codex (and other reasoning models) emit no text while thinking; label the
  // phase explicitly so a long silent stretch reads as active, not hung.
  const label = reasoning ? "reasoning" : "thinking";
  return (
    <Text bold color={theme.success}>
      {pulse} lucky{" "}
      <Text color={theme.accent}>
        {label}{dots}
      </Text>{" "}
      <Text color="white">({elapsedSeconds}s)</Text>
    </Text>
  );
}

export const ThinkingStatus = React.memo(ThinkingStatusInner);
