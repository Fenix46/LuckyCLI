import { Box, Text } from "../../vendor/ink-compat.js";
import React from "react";
import type { Theme } from "../themes.js";
import type { UserQuestionRequest } from "../lib/requests.js";
import { KeyHints, OptionRow, SectionTitle } from "./kit.js";

// The TUI always lets the user type their own answer, even when the model
// passed allowFreeText: false — the options are suggestions, never a cage.
// While a typed answer is pending it wins over the highlighted option, so the
// cursor is hidden to make that visible.
export function UserQuestionRequestView({
  request,
  selectedIndex,
  typing,
  theme,
  width,
}: {
  request: UserQuestionRequest;
  selectedIndex: number;
  /** The input holds a non-empty answer; Enter will send it, not the option. */
  typing: boolean;
  theme: Theme;
  width: number;
}): React.JSX.Element {
  const options = request.options ?? [];
  const panelWidth = Math.max(48, Math.min(width, 104));
  return (
    <Box flexDirection="column" width={panelWidth}>
      <SectionTitle theme={theme} title="Question" detail="lucky needs your input" />

      <Box marginTop={1}>
        <Text bold color={theme.text}>{request.question}</Text>
      </Box>

      {options.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {options.map((option, index) => (
            <OptionRow
              key={`${option}-${index}`}
              theme={theme}
              selected={!typing && index === selectedIndex}
              label={option}
            />
          ))}
        </Box>
      ) : null}

      <KeyHints
        theme={theme}
        hints={
          typing || options.length === 0
            ? [["type", "an answer"], ["enter", "send"], ["esc", "skip"]]
            : [["↑↓", "move"], ["enter", "pick"], ["type", "your own answer"], ["esc", "skip"]]
        }
      />
    </Box>
  );
}
