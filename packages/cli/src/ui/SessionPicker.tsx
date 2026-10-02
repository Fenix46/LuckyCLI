import { Box, Text, useInput } from "../vendor/ink-compat.js";
import React, { useMemo, useState } from "react";
import { basename } from "node:path";
import { listSessions, loadSession, loadStoredConfig, type Session, type SessionMeta } from "@luckycli/core";
import { themeById } from "./themes.js";
import { KeyHints, OptionRow, SectionTitle } from "./components/kit.js";
import { truncateSingleLine } from "./lib/format.js";

interface SessionPickerProps {
  /** Called with the chosen session when the user picks one. */
  onSelect: (session: Session) => void;
  /** Called when the user dismisses the picker (Esc) or there's nothing to pick. */
  onCancel: () => void;
  /** Project directory whose sessions are listed first. Defaults to the process cwd. */
  cwd?: string;
}

type Scope = "project" | "all";

/** Rows shown at once; the list scrolls to keep the cursor in view. */
const WINDOW = 12;

/** "just now", "12m ago", "3h ago", "yesterday", "4d ago", else the date. */
export function formatRelativeTime(ms: number, now = Date.now()): string {
  const minutes = Math.floor((now - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Interactive list of saved sessions for `lucky --resume` and /resume. It
 * opens on this project's sessions (falling back to every project when this
 * one has none); tab switches between the two. Arrow keys move, Enter
 * resumes, Esc starts a fresh session instead.
 */
export function SessionPicker({ onSelect, onCancel, cwd = process.cwd() }: SessionPickerProps): React.JSX.Element {
  const theme = themeById(loadStoredConfig().theme);
  const projectSessions = useMemo(() => listSessions({ cwd }), [cwd]);
  const allSessions = useMemo(() => listSessions(), []);
  const [scope, setScope] = useState<Scope>(projectSessions.length > 0 ? "project" : "all");
  const [index, setIndex] = useState(0);
  const sessions: SessionMeta[] = scope === "project" ? projectSessions : allSessions;
  const safeIndex = Math.min(index, Math.max(0, sessions.length - 1));
  const width = process.stdout.columns ?? 100;

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.tab) {
      setScope((current) => (current === "project" ? "all" : "project"));
      setIndex(0);
      return;
    }
    if (sessions.length === 0) return;
    if (key.upArrow || input === "k") {
      setIndex((i) => (Math.min(i, sessions.length - 1) - 1 + sessions.length) % sessions.length);
    } else if (key.downArrow || input === "j") {
      setIndex((i) => (Math.min(i, sessions.length - 1) + 1) % sessions.length);
    } else if (key.return) {
      const meta = sessions[safeIndex];
      const session = meta ? loadSession(meta.id) : undefined;
      if (session) onSelect(session);
      else onCancel();
    }
  });

  const project = basename(cwd) || cwd;
  const otherCount = allSessions.length - projectSessions.length;
  const start = Math.max(0, Math.min(safeIndex - Math.floor(WINDOW / 2), sessions.length - WINDOW));
  const visible = sessions.slice(start, start + WINDOW);
  const titleWidth = Math.max(20, Math.min(56, width - 50));

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} width="100%">
      <SectionTitle
        theme={theme}
        title="Resume session"
        detail={
          scope === "project"
            ? `${project} · ${projectSessions.length} saved`
            : `all projects · ${allSessions.length} saved`
        }
      />
      <Box marginTop={1} flexDirection="column">
        {sessions.length === 0 ? (
          <Text color={theme.muted}>
            {scope === "project" ? `No saved sessions in ${project} yet.` : "No saved sessions on this machine yet."}
          </Text>
        ) : (
          visible.map((meta, offset) => (
            <OptionRow
              key={meta.id}
              theme={theme}
              selected={start + offset === safeIndex}
              label={truncateSingleLine(meta.title ?? "(untitled)", titleWidth)}
              labelWidth={titleWidth}
              detail={sessionDetail(meta, scope)}
            />
          ))
        )}
        {sessions.length > WINDOW ? (
          <Text color={theme.muted}>
            {"    "}
            {safeIndex + 1} of {sessions.length}
          </Text>
        ) : null}
      </Box>
      <KeyHints
        theme={theme}
        hints={[
          ["↑↓", "move"],
          ["enter", "resume"],
          [
            "tab",
            scope === "project"
              ? `all projects${otherCount > 0 ? ` (+${otherCount})` : ""}`
              : "this project",
          ],
          ["esc", "start fresh"],
        ]}
      />
    </Box>
  );
}

function sessionDetail(meta: SessionMeta, scope: Scope): string {
  const parts = [formatRelativeTime(meta.updatedAt), `${meta.provider}/${meta.model}`, `${meta.messageCount} msgs`];
  if (scope === "all") parts.push(meta.cwd ? basename(meta.cwd) : "unknown project");
  return parts.join(" · ");
}
