import { Text } from "../../vendor/ink-compat.js";
import React from "react";
import type { Theme } from "../themes.js";

function ThinkingStatusInner({
  theme,
  elapsedSeconds,
  frame,
  reasoning,
  label: labelOverride,
}: {
  theme: Theme;
  elapsedSeconds: number;
  frame: number;
  reasoning?: boolean;
  label?: string;
}): React.JSX.Element {
  const frames = ["●", "●", "◆", "◆", "▲", "▲"];
  const pulse = frames[frame % frames.length] ?? "●";
  const dots = ".".repeat((frame % 3) + 1).padEnd(3, " ");
  // An explicit label (e.g. "compacting") wins; otherwise Codex reasoning shows
  // "reasoning" and the default is "thinking". Either way the phase reads as
  // active, not hung, during a long silent stretch.
  const label = labelOverride ?? (reasoning ? "reasoning" : "thinking");
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
