import { Box, Text } from "../../vendor/ink-compat.js";
import React from "react";
import type { ContentPart } from "@luckycli/core";
import type { Theme } from "../themes.js";
import { truncateSingleLine } from "../lib/format.js";
import { SectionTitle } from "./kit.js";

/** A prompt submitted while a turn was running, waiting for its own turn. */
export interface QueuedPrompt {
  /** Expanded prompt text, shown in the transcript when it is sent. */
  text: string;
  /** What goes to the model (text, or text + attached images). */
  content: string | ContentPart[];
}

// Keep the panel short: the next few prompts matter, the tail is a count.
const MAX_VISIBLE = 3;

/**
 * Compact list of queued prompts above the input frame, so the user sees what
 * will run next once the current turn settles.
 */
function QueuedPromptsViewInner({
  prompts,
  theme,
  width,
}: {
  prompts: QueuedPrompt[];
  theme: Theme;
  width: number;
}): React.JSX.Element {
  const visible = prompts.slice(0, MAX_VISIBLE);
  const hidden = prompts.length - visible.length;
  return (
    <Box flexDirection="column" marginTop={1} paddingLeft={1}>
      <SectionTitle
        theme={theme}
        title={`Queued (${prompts.length})`}
        detail="sent when this turn ends · esc restores them"
      />
      {visible.map((prompt, index) => (
        <Text key={index} color={theme.text} wrap="truncate-end">
          {"  "}
          <Text color={theme.muted}>{index + 1}.</Text> {truncateSingleLine(prompt.text, Math.max(16, width - 8))}
        </Text>
      ))}
      {hidden > 0 ? (
        <Text color={theme.muted}>
          {"  "}+{hidden} more
        </Text>
      ) : null}
    </Box>
  );
}

export const QueuedPromptsView = React.memo(QueuedPromptsViewInner);
