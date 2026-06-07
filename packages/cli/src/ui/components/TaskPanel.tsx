import { Box, Text } from "../../vendor/ink-compat.js";
import React from "react";
import type { Task, TaskStatus } from "@luckycli/core";
import type { Theme } from "../themes.js";
import { truncateSingleLine } from "../lib/format.js";

/**
 * The live work task list, rendered as a checklist anchored in the bottom
 * chrome (above the prompt input). Ported, single-agent, from Claude Code's
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
}: {
  tasks: Task[];
  theme: Theme;
  width: number;
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
      <Box marginBottom={1} paddingLeft={2}>
        <Text color={theme.success} dimColor>
          ✔ Tasks ({completed} done) — use /task to review or /task clear to reset
        </Text>
      </Box>
    );
  }

  const headerParts = [`${completed} done`];
  if (inProgress > 0) headerParts.push(`${inProgress} in progress`);
  headerParts.push(`${pending} open`);

  // Leave room for the two-space indent, the icon + space, and a little slack.
  const maxSubject = Math.max(15, width - 8);

  return (
    <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
      <Text color={theme.muted}>
        Tasks (<Text bold>{tasks.length}</Text>: {headerParts.join(", ")})
      </Text>
      <Box flexDirection="column">
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} theme={theme} maxSubject={maxSubject} />
        ))}
      </Box>
    </Box>
  );
}

function statusIcon(status: TaskStatus): string {
  switch (status) {
    case "completed":
      return "✔";
    case "in_progress":
      return "■";
    case "pending":
      return "☐";
  }
}

function statusColor(status: TaskStatus, theme: Theme): string {
  switch (status) {
    case "completed":
      return theme.success;
    case "in_progress":
      return theme.accent;
    case "pending":
      return theme.muted;
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
  const subject =
    isInProgress && task.activeForm
      ? `${task.subject} (${task.activeForm})`
      : task.subject;
  const color = statusColor(task.status, theme);

  return (
    <Box flexDirection="row" gap={1}>
      <Text color={color}>{statusIcon(task.status)}</Text>
      <Text
        color={isCompleted ? theme.muted : "white"}
        bold={isInProgress}
        dimColor={isCompleted}
        strikethrough={isCompleted}
        wrap="truncate-end"
      >
        {truncateSingleLine(subject, maxSubject)}
      </Text>
    </Box>
  );
}
