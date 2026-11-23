import { Box, Text } from "../../vendor/ink-compat.js";
import React from "react";
import type { Theme } from "../themes.js";
import { SPINNER_FRAMES } from "./constants.js";
import { formatElapsed, truncateSingleLine } from "../lib/format.js";
import { thinkingSynonym } from "../lib/activity.js";

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
  verb,
  retry,
  label: labelOverride,
  detail,
  width,
}: {
  theme: Theme;
  elapsedSeconds: number;
  frame: number;
  /** Coarse activity phase; picks the fallback verb. */
  phase: "thinking" | "reasoning" | "responding" | "working";
  /** Contextual verb (e.g. "Reading"); wins over the phase. */
  verb?: string;
  /** A provider retry in progress; wins over the verb. */
  retry?: { attempt: number; maxAttempts: number };
  /** Explicit override (e.g. "summarizing") wins over everything. */
  label?: string;
  /** What is running right now (e.g. the tool target), shown after the verb. */
  detail?: string;
  /** Available width, so a long detail truncates instead of wrapping. */
  width?: number;
}): React.JSX.Element {
  const pulse = SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? "⠋";
  const titleBase =
    labelOverride ??
    (retry
      ? `Retrying (${retry.attempt}/${retry.maxAttempts})`
      : verb ??
        (phase === "reasoning"
          ? "Reasoning"
          : phase === "responding"
            ? "Responding"
            : phase === "working"
              ? "Working"
              : thinkingSynonym(elapsedSeconds)));
  const title = `${titleBase.charAt(0).toUpperCase()}${titleBase.slice(1)}…`;
  const elapsed = formatElapsed(elapsedSeconds);
  // "⠋ Working… · <detail>   12s · esc to interrupt": fixed parts first,
  // the detail gets whatever width remains.
  const fixed = 2 + title.length + 3 + 3 + elapsed.length + 20;
  const room = width !== undefined ? width - fixed : 80;
  const shownDetail = detail && room >= 12 ? truncateSingleLine(detail, room) : undefined;
  return (
    <Box marginTop={1}>
      <Text wrap="truncate-end">
        <Text bold color={theme.primary}>{pulse} </Text>
        <Text bold color={theme.text}>{title}</Text>
        {shownDetail ? <Text color={theme.accent}> {shownDetail}</Text> : null}
        <Text color={theme.muted}>  {elapsed} · esc to interrupt</Text>
      </Text>
    </Box>
  );
}

export const ActivityIndicator = React.memo(ActivityIndicatorInner);
