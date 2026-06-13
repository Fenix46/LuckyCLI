import type { Task, TaskStatus } from "@luckycli/core";

export const TASK_WINDOW_SIZE = 5;

export interface TaskWindow {
  /** The tasks to render, in display order. */
  visible: Task[];
  /** Counts of what was collapsed away, by status (zero when nothing hidden). */
  hidden: { inProgress: number; pending: number; completed: number };
  /** Total hidden, for the quick "+N" check. */
  hiddenCount: number;
}

const STATUS_ORDER: Record<TaskStatus, number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
};

/**
 * Pick which tasks to show in the compact panel.
 *
 * Adapted from Claude Code's TaskListV2 truncation, single-agent: when the list
 * is longer than the window, prioritize what the user cares about now —
 * in-progress first, then the next pending tasks, then recently-completed ones
 * as context — and collapse the rest into a "+N" summary. As tasks complete and
 * flip to `completed` they sort to the bottom, so the next pending work rolls up
 * into view automatically without reordering the underlying list.
 *
 * `limit <= 0` or a list within the window returns everything (stable original
 * order), so the caller can pass the full list for the expanded (Ctrl+O) view.
 */
export function selectTaskWindow(tasks: Task[], limit = TASK_WINDOW_SIZE): TaskWindow {
  const noHidden = { inProgress: 0, pending: 0, completed: 0 };

  if (limit <= 0 || tasks.length <= limit) {
    return { visible: tasks, hidden: { ...noHidden }, hiddenCount: 0 };
  }

  // Stable priority sort: keep the caller's order within a status bucket.
  const prioritized = tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => {
      const byStatus = STATUS_ORDER[a.task.status] - STATUS_ORDER[b.task.status];
      return byStatus !== 0 ? byStatus : a.index - b.index;
    })
    .map((entry) => entry.task);

  const visible = prioritized.slice(0, limit);
  const hiddenTasks = prioritized.slice(limit);

  const hidden = { ...noHidden };
  for (const task of hiddenTasks) {
    if (task.status === "in_progress") hidden.inProgress += 1;
    else if (task.status === "pending") hidden.pending += 1;
    else hidden.completed += 1;
  }

  return { visible, hidden, hiddenCount: hiddenTasks.length };
}

/** "+3 pending, 2 completed" style summary for the collapsed footer. */
export function formatHiddenSummary(hidden: TaskWindow["hidden"]): string {
  const parts: string[] = [];
  if (hidden.inProgress > 0) parts.push(`${hidden.inProgress} in progress`);
  if (hidden.pending > 0) parts.push(`${hidden.pending} pending`);
  if (hidden.completed > 0) parts.push(`${hidden.completed} completed`);
  return parts.join(", ");
}
