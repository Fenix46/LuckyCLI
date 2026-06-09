import { Box, Text, useInput } from "../vendor/ink-compat.js";
import React, { useMemo } from "react";
import { SelectList } from "./components/SelectList.js";
import { listSessions, loadSession, loadStoredConfig, type Session } from "@luckycli/core";
import { themeById } from "./themes.js";

interface SessionPickerProps {
  /** Called with the chosen session when the user picks one. */
  onSelect: (session: Session) => void;
  /** Called when the user dismisses the picker (Esc) or there's nothing to pick. */
  onCancel: () => void;
}

function formatWhen(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16);
}

/**
 * Interactive list of saved sessions for `lucky --resume` (no id). Arrow keys to
 * move, Enter to resume, Esc to start a fresh session instead.
 */
export function SessionPicker({ onSelect, onCancel }: SessionPickerProps): React.JSX.Element {
  const theme = themeById(loadStoredConfig().theme);
  const sessions = useMemo(() => listSessions(), []);

  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1} width="100%">
        <Text bold color={theme.accent}>▌ Resume session</Text>
        <Box marginTop={1}>
          <Text color={theme.muted}>No saved sessions were found on this machine.</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.muted} dimColor>esc start fresh</Text>
        </Box>
      </Box>
    );
  }

  const items = sessions.map((s) => ({
    key: s.id,
    label: `${formatWhen(s.updatedAt)}  ${s.provider}/${s.model}  ${s.messageCount} msgs  ${s.title ?? "(untitled)"}`,
    value: s.id,
  }));

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} width="100%">
      <Text bold color={theme.accent}>
        ▌ Resume session <Text color={theme.muted}>· {sessions.length} saved</Text>
      </Text>
      <Box marginY={1} flexDirection="column">
        <SelectList
          items={items}
          theme={theme}
          onSelect={(item) => {
            const session = loadSession(item.value);
            if (session) onSelect(session);
            else onCancel();
          }}
        />
      </Box>
      <Text color={theme.muted} dimColor>↑↓ move · enter resume · esc start fresh</Text>
    </Box>
  );
}
