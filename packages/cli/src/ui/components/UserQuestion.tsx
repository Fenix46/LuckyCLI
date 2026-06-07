import { Box, Text } from "../../vendor/ink-compat.js";
import React from "react";
import type { Theme } from "../themes.js";
import type { UserQuestionRequest } from "../lib/requests.js";

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
    <Box
      flexDirection="column"
      marginTop={1}
      width={panelWidth}
      borderStyle="single"
      borderColor={theme.accent}
      borderTop={false}
      borderRight={false}
      borderBottom={false}
      paddingLeft={2}
    >
      <Box flexDirection="row">
        <Text bold color={theme.accent}>● Question from agent</Text>
        <Text color={theme.muted}>  ·  </Text>
        <Text bold color={theme.accent}>ask_user</Text>
      </Box>

      <Box marginTop={1}>
        <Text bold color="white">{request.question}</Text>
      </Box>

      {options.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {options.map((option, index) => {
            const active = index === selectedIndex;
            return (
              <Box key={`${option}-${index}`} flexDirection="row">
                <Text color={active ? theme.accent : theme.muted}>
                  {active ? "❯ " : "  "}
                </Text>
                <Text
                  bold={active}
                  color={active ? theme.accent : "white"}
                  dimColor={!active}
                >
                  {option}
                </Text>
              </Box>
            );
          })}
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text color={theme.muted} dimColor>
          {options.length > 0 ? "↑↓ move · " : ""}
          {freeText
            ? options.length > 0
              ? "enter picks ❯ · or type to answer · esc skip"
              : "type an answer · enter to send · esc skip"
            : "enter to select · esc skip"}
        </Text>
      </Box>
    </Box>
  );
}
