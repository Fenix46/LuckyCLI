import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import React, { useMemo } from "react";
import { listSessions, loadSession, type Session } from "@luckycli/core";

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
  const sessions = useMemo(() => listSessions(), []);

  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text color="yellow">No saved sessions to resume.</Text>
        <Text color="gray" dimColor>Press Esc to start a new session.</Text>
      </Box>
    );
  }

  const items = sessions.map((s) => ({
    key: s.id,
    label: `${formatWhen(s.updatedAt)}  ${s.provider}/${s.model}  ${s.messageCount} msgs  ${s.title ?? "(untitled)"}`,
    value: s.id,
  }));

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold color="cyan">
        ⏪ RESUME A SESSION
      </Text>
      <Text color="gray" dimColor>
        ↑/↓ to choose · Enter to resume · Esc to start fresh
      </Text>
      <Box marginTop={1} flexDirection="column">
        <SelectInput
          items={items}
          onSelect={(item) => {
            const session = loadSession(item.value);
            if (session) onSelect(session);
            else onCancel();
          }}
        />
      </Box>
    </Box>
  );
}
