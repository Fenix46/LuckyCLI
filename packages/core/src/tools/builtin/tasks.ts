import { z } from "zod";
import {
  createTask,
  getTask,
  listTasks,
  TASK_STATUSES,
  updateTask,
  type Task,
} from "../../tasks/store.js";
import { defineTool } from "../types.js";

/** One-line summary of a task for list output. */
function formatTaskLine(task: Task): string {
  const active =
    task.status === "in_progress" && task.activeForm
      ? ` (${task.activeForm})`
      : "";
  return `#${task.id} [${task.status}] ${task.subject}${active}`;
}

/** Full detail block for a single task. */
function formatTaskDetail(task: Task): string {
  const lines = [
    `#${task.id} — ${task.subject}`,
    `status: ${task.status}`,
  ];
  if (task.activeForm) lines.push(`activeForm: ${task.activeForm}`);
  lines.push("", task.description);
  return lines.join("\n");
}

const WHEN_TO_USE = `Build and maintain a structured task list for non-trivial work — an upgrade, a fix, or a new feature. This lets you plan the work up front, track progress, and show the user where things stand.

Use task_create proactively when:
- The work needs 3+ distinct steps, or careful planning.
- The user asks you to plan a piece of work, or hands you several things to do.
- You discover follow-up work mid-implementation.

Workflow: create the tasks first, then mark each one in_progress with task_update BEFORE starting it and completed when done. Do NOT use a task list for a single trivial step — just do it.`;

export const taskCreateTool = defineTool({
  name: "task_create",
  description: `Create one task in the work task list. ${WHEN_TO_USE}`,
  schema: z.object({
    subject: z.string().min(1).describe("A brief title for the task."),
    description: z
      .string()
      .min(1)
      .describe("What needs to be done — enough detail to act on later."),
    activeForm: z
      .string()
      .optional()
      .describe(
        'Present-continuous form shown while in_progress (e.g. "Running tests").',
      ),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Arbitrary metadata to attach to the task."),
  }),
  async execute({ subject, description, activeForm, metadata }, ctx) {
    const task = createTask(ctx.cwd, {
      subject,
      description,
      activeForm,
      metadata,
      status: "pending",
    });
    return { content: `Created task #${task.id}: ${task.subject}` };
  },
});

export const taskListTool = defineTool({
  name: "task_list",
  description:
    "List all tasks in the work task list for the current project, with their status.",
  readonly: true,
  schema: z.object({}),
  async execute(_input, ctx) {
    const tasks = listTasks(ctx.cwd);
    if (tasks.length === 0) {
      return { content: "The task list is empty." };
    }
    const counts = tasks.reduce(
      (acc, t) => {
        acc[t.status] += 1;
        return acc;
      },
      { pending: 0, in_progress: 0, completed: 0 },
    );
    const header = `${counts.completed} completed, ${counts.in_progress} in progress, ${counts.pending} pending.`;
    return {
      content: `${header}\n${tasks.map(formatTaskLine).join("\n")}`,
    };
  },
});

export const taskGetTool = defineTool({
  name: "task_get",
  description: "Get the full details of a single task by id.",
  readonly: true,
  schema: z.object({
    id: z.string().describe("The task id (e.g. \"3\")."),
  }),
  async execute({ id }, ctx) {
    const task = getTask(ctx.cwd, id);
    if (!task) {
      return { content: `No task #${id} found.`, isError: true };
    }
    return { content: formatTaskDetail(task) };
  },
});

export const taskUpdateTool = defineTool({
  name: "task_update",
  description:
    "Update a task: change its status (pending → in_progress → completed) or " +
    "edit its fields. Mark a task in_progress before working on it and completed when done.",
  schema: z.object({
    id: z.string().describe("The task id to update."),
    status: z
      .enum(TASK_STATUSES)
      .optional()
      .describe("New status for the task."),
    subject: z.string().min(1).optional().describe("New title."),
    description: z.string().min(1).optional().describe("New description."),
    activeForm: z
      .string()
      .optional()
      .describe("New present-continuous form shown while in_progress."),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Replace the task metadata."),
  }),
  async execute({ id, ...updates }, ctx) {
    const task = updateTask(ctx.cwd, id, updates);
    if (!task) {
      return { content: `No task #${id} found.`, isError: true };
    }
    return { content: `Updated task #${task.id} → ${task.status}: ${task.subject}` };
  },
});
