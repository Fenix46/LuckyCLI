import { Box, Text } from "../../vendor/ink-compat.js";
import React from "react";
import type { Task, TaskStatus } from "@luckycli/core";
import type { Theme } from "../themes.js";
import { truncateSingleLine } from "../lib/format.js";
import { selectTaskWindow, formatHiddenSummary } from "../lib/task-window.js";
import { GLYPH } from "./kit.js";

/**
 * The live work task list, rendered as a checklist anchored in the bottom
 * chrome, right under the activity line and above the prompt input. Ported, single-agent, from Claude Code's
 * TaskListV2: one row per task with a status icon, a counts header, and the
 * in-progress task highlighted. It re-renders whenever the on-disk task list
 * changes (App subscribes to onTasksUpdated and re-reads listTasks).
 *
 * Renders nothing when the list is empty so it adds no chrome until there is a
 * plan to show.
 */
export function TaskPanel({
  tasks,
  theme,
  width,
  expanded = false,
}: {
  tasks: Task[];
  theme: Theme;
  width: number;
  /** Ctrl+O expands the panel to the full list instead of a rolling window. */
  expanded?: boolean;
}): React.JSX.Element | null {
  if (tasks.length === 0) return null;

  const completed = tasks.filter((t) => t.status === "completed").length;
  const inProgress = tasks.filter((t) => t.status === "in_progress").length;
  const pending = tasks.length - completed - inProgress;

  // Once everything is done, the full checklist is just noise that lingers for
  // the rest of the session. Collapse it to a single summary line so it stops
  // hogging chrome; a new pending/in_progress task re-expands it automatically.
  // The list still lives on disk and is viewable via /task.
  if (pending === 0 && inProgress === 0) {
    return (
      <Box marginTop={1} paddingLeft={1}>
        <Text color={theme.muted}>
          <Text color={theme.success}>{GLYPH.ok}</Text> {completed} {completed === 1 ? "task" : "tasks"} done
          {"  "}
          <Text color={theme.subtle}>/task to review · /task clear to reset</Text>
        </Text>
      </Box>
    );
  }

  const headerParts = [`${completed}/${tasks.length} done`];
  if (inProgress > 0) headerParts.push(`${inProgress} in progress`);

  // Leave room for the rail, the indent, the icon + space, and a little slack.
  const maxSubject = Math.max(15, width - 10);

  // Compact by default: show a rolling window so a long plan doesn't eat the
  // screen. Ctrl+O expands to the whole list (limit 0 = no truncation).
  const { visible, hidden, hiddenCount } = selectTaskWindow(tasks, expanded ? 0 : undefined);

  // A colored rail sets the checklist apart from the tool rows streaming in
  // the transcript above it, so the plan reads as its own block.
  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="single"
      borderColor={inProgress > 0 ? theme.accent : theme.primary}
      borderTop={false}
      borderRight={false}
      borderBottom={false}
      paddingLeft={1}
    >
      <Text wrap="truncate-end">
        <Text bold color={theme.text}>Tasks</Text>
        {"  "}
        <ProgressBar done={completed} total={tasks.length} theme={theme} />
        <Text color={theme.muted}>  {headerParts.join(` ${GLYPH.dot} `)}</Text>
      </Text>
      <Box flexDirection="column">
        {visible.map((task) => (
          <TaskRow key={task.id} task={task} theme={theme} maxSubject={maxSubject} />
        ))}
      </Box>
      {hiddenCount > 0 ? (
        <Text color={theme.muted}>
          … +{formatHiddenSummary(hidden)} · ctrl+o to expand
        </Text>
      ) : null}
    </Box>
  );
}

const PROGRESS_CELLS = 10;

function ProgressBar({ done, total, theme }: { done: number; total: number; theme: Theme }): React.JSX.Element {
  const filled = total > 0 ? Math.round((done / total) * PROGRESS_CELLS) : 0;
  return (
    <Text>
      <Text color={theme.success}>{"▰".repeat(filled)}</Text>
      <Text color={theme.subtle}>{"▱".repeat(PROGRESS_CELLS - filled)}</Text>
    </Text>
  );
}

function statusIcon(status: TaskStatus): string {
  switch (status) {
    case "completed":
      return GLYPH.ok;
    case "in_progress":
      return GLYPH.active;
    case "pending":
      return "○";
  }
}

function statusColor(status: TaskStatus, theme: Theme): string {
  switch (status) {
    case "completed":
      return theme.success;
    case "in_progress":
      return theme.accent;
    case "pending":
      return theme.text;
  }
}

function TaskRow({
  task,
  theme,
  maxSubject,
}: {
  task: Task;
  theme: Theme;
  maxSubject: number;
}): React.JSX.Element {
  const isCompleted = task.status === "completed";
  const isInProgress = task.status === "in_progress";
  const color = statusColor(task.status, theme);
  // The in-progress row says what is happening now (activeForm) after the
  // subject; the budget is shared so the row never wraps.
  const active = isInProgress && task.activeForm ? task.activeForm : undefined;
  const subject = truncateSingleLine(task.subject, active ? Math.max(10, maxSubject - active.length - 3) : maxSubject);

  return (
    <Box flexDirection="row" gap={1}>
      <Text color={color}>{statusIcon(task.status)}</Text>
      <Text wrap="truncate-end">
        <Text color={isCompleted ? theme.muted : isInProgress ? theme.accent : theme.text} bold={isInProgress} strikethrough={isCompleted}>
          {subject}
        </Text>
        {active ? <Text color={theme.muted}> {GLYPH.dot} {active}</Text> : null}
      </Text>
    </Box>
  );
}
