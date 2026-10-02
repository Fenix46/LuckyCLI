import { Box, Text, useInput } from "../vendor/ink-compat.js";
import React, { useMemo } from "react";
import { SelectList } from "./components/SelectList.js";
import { listSessions, loadSession, loadStoredConfig, type Session } from "@luckycli/core";
import { themeById } from "./themes.js";
import { KeyHints, SectionTitle } from "./components/kit.js";

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
        <SectionTitle theme={theme} title="Resume session" />
        <Box marginTop={1}>
          <Text color={theme.muted}>No saved sessions were found on this machine.</Text>
        </Box>
        <KeyHints theme={theme} hints={[["esc", "start fresh"]]} />
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
      <SectionTitle theme={theme} title="Resume session" detail={`${sessions.length} saved`} />
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
      <KeyHints
        theme={theme}
        marginTop={0}
        hints={[
          ["↑↓", "move"],
          ["enter", "resume"],
          ["esc", "start fresh"],
        ]}
      />
    </Box>
  );
}
