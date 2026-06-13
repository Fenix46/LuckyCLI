import { Box, Text } from "../../vendor/ink-compat.js";
import React from "react";
import type { Theme } from "../themes.js";
import { SPINNER_FRAMES } from "./constants.js";
import { formatElapsed } from "../lib/format.js";

/**
 * The persistent "working" indicator, fixed above the input frame.
 *
 * Modeled on Claude Code's footer spinner (e.g. "· Determining… (3m 2s)"): it
 * stays visible for the WHOLE turn, no matter what the model is doing —
 * streaming text, running a tool, or pausing silently between deltas — so the
 * UI never looks frozen. Previously this lived as a transient item at the tail
 * of the transcript, where a tool result or the task panel could push it out of
 * view and make a working model look stalled.
 *
 * Provider-agnostic: the verb is derived from a coarse phase, never from a
 * specific provider's event shape.
 */
function ActivityIndicatorInner({
  theme,
  elapsedSeconds,
  frame,
  phase,
  label: labelOverride,
}: {
  theme: Theme;
  elapsedSeconds: number;
  frame: number;
  /** Coarse activity phase; picks the verb. */
  phase: "thinking" | "reasoning" | "responding";
  /** Explicit override (e.g. "compacting") wins over the phase verb. */
  label?: string;
}): React.JSX.Element {
  const pulse = SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? "⠋";
  const dots = ".".repeat((Math.floor(frame / 4) % 3) + 1).padEnd(3, " ");
  const verb =
    labelOverride ??
    (phase === "reasoning" ? "reasoning" : phase === "responding" ? "responding" : "thinking");
  return (
    <Box marginTop={1}>
      <Text bold color={theme.success}>
        {pulse} lucky{" "}
        <Text color={theme.accent}>
          {verb}
          {dots}
        </Text>{" "}
        <Text color="white">({formatElapsed(elapsedSeconds)})</Text>
      </Text>
    </Box>
  );
}

export const ActivityIndicator = React.memo(ActivityIndicatorInner);
