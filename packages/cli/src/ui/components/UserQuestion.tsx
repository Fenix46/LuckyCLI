import { Box, Text } from "../../vendor/ink-compat.js";
import React from "react";
import type { Theme } from "../themes.js";
import type { UserQuestionRequest } from "../lib/requests.js";
import { KeyHints, OptionRow, SectionTitle } from "./kit.js";

export function UserQuestionRequestView({
  request,
  selectedIndex,
  theme,
  width,
}: {
  request: UserQuestionRequest;
  selectedIndex: number;
  theme: Theme;
  width: number;
}): React.JSX.Element {
  const options = request.options ?? [];
  const freeText = request.allowFreeText ?? true;
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
            <OptionRow key={`${option}-${index}`} theme={theme} selected={index === selectedIndex} label={option} />
          ))}
        </Box>
      ) : null}

      <KeyHints
        theme={theme}
        hints={[
          ...(options.length > 0 ? [["↑↓", "move"] as const] : []),
          ...(freeText
            ? options.length > 0
              ? ([["enter", "pick"], ["type", "to answer"], ["esc", "skip"]] as const)
              : ([["type", "an answer"], ["enter", "send"], ["esc", "skip"]] as const)
            : ([["enter", "select"], ["esc", "skip"]] as const)),
        ]}
      />
    </Box>
  );
}
