/**
 * Persistent on-disk work task list at ~/.luckycli/tasks/<project>/<id>.json.
 *
 * A "task" is one item in a structured plan the agent builds for a non-trivial
 * piece of work (an upgrade, a fix, a new feature): subject + description +
 * status (pending → in_progress → completed). One JSON file per task keeps the
 * list inspectable and lets it survive across sessions.
 *
 * The list is keyed by project (the agent's cwd), not by session id, so a plan
 * started in one session is still there when you reopen the same repo.
 *
 * Ported and pared down from Claude Code's task list (src/utils/tasks.ts):
 * single-agent only. The `owner` / `blocks` / `blockedBy` fields are carried as
 * optional so a future multi-agent/team layer (claimTask, agent status) can be
 * added on top of the same file-per-task storage without a rewrite.
 */

import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export const TASK_STATUSES = ["pending", "in_progress", "completed"] as const;

export const TaskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  subject: z.string(),
  description: z.string(),
  /** Present-continuous form shown in a spinner while in_progress (e.g. "Running tests"). */
  activeForm: z.string().optional(),
  status: TaskStatusSchema,
  /** Carried for a future multi-agent layer; unused single-agent. */
  owner: z.string().optional(),
  blocks: z.array(z.string()).optional(),
  blockedBy: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type Task = z.infer<typeof TaskSchema>;

/** Fields a caller supplies when creating a task (the id is assigned by the store). */
export type NewTask = Omit<Task, "id">;

/**
 * Fired whenever the task list for a project changes. The CLI subscribes to
 * redraw the `/task` view and any spinner reflecting the in_progress task.
 */
const emitter = new EventEmitter();
const TASKS_UPDATED = "tasks-updated";

/** Subscribe to task-list changes. Returns an unsubscribe function. */
export function onTasksUpdated(listener: (cwd: string) => void): () => void {
  emitter.on(TASKS_UPDATED, listener);
  return () => emitter.off(TASKS_UPDATED, listener);
}

function notifyTasksUpdated(cwd: string): void {
  emitter.emit(TASKS_UPDATED, cwd);
}

/**
 * Make a string safe to use as a single path component: only alphanumerics,
 * hyphens and underscores survive. Mirrors Claude Code's sanitizePathComponent.
 */
export function sanitizePathComponent(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, "-");
}

/** Directory holding the task files for a given project cwd. */
export function tasksDirForCwd(cwd: string): string {
  return join(homedir(), ".luckycli", "tasks", sanitizePathComponent(cwd));
}

function taskFilePath(cwd: string, id: string): string {
  return join(tasksDirForCwd(cwd), `${sanitizePathComponent(id)}.json`);
}

function ensureTasksDir(cwd: string): string {
  const dir = tasksDirForCwd(cwd);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Atomic write via a temp file + rename, matching the session store's style. */
function writeJsonAtomic(path: string, value: unknown): void {
  const dir = join(path, "..");
  const tmp = join(dir, `.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

/** Highest numeric id currently on disk for this project (0 when empty). */
function highestTaskId(cwd: string): number {
  const dir = tasksDirForCwd(cwd);
  if (!existsSync(dir)) return 0;
  let highest = 0;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const n = Number.parseInt(file.slice(0, -".json".length), 10);
    if (Number.isFinite(n) && n > highest) highest = n;
  }
  return highest;
}

/** Create a new task with the next sequential id. Returns the created task. */
export function createTask(cwd: string, data: NewTask): Task {
  ensureTasksDir(cwd);
  const id = String(highestTaskId(cwd) + 1);
  const task: Task = TaskSchema.parse({ ...data, id });
  writeJsonAtomic(taskFilePath(cwd, id), task);
  notifyTasksUpdated(cwd);
  return task;
}

/** Read a single task, or null if it doesn't exist / fails validation. */
export function getTask(cwd: string, id: string): Task | null {
  const path = taskFilePath(cwd, id);
  if (!existsSync(path)) return null;
  try {
    const parsed = TaskSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Apply a partial update to an existing task. Returns the updated task or null. */
export function updateTask(
  cwd: string,
  id: string,
  updates: Partial<NewTask>,
): Task | null {
  const existing = getTask(cwd, id);
  if (!existing) return null;
  const updated: Task = TaskSchema.parse({ ...existing, ...updates, id });
  writeJsonAtomic(taskFilePath(cwd, id), updated);
  notifyTasksUpdated(cwd);
  return updated;
}

/** Delete a task by id. Returns true if a file was removed. */
export function deleteTask(cwd: string, id: string): boolean {
  const path = taskFilePath(cwd, id);
  if (!existsSync(path)) return false;
  rmSync(path);
  notifyTasksUpdated(cwd);
  return true;
}

/** All tasks for a project, sorted by numeric id ascending. */
export function listTasks(cwd: string): Task[] {
  const dir = tasksDirForCwd(cwd);
  if (!existsSync(dir)) return [];
  const tasks: Task[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const task = getTask(cwd, file.slice(0, -".json".length));
    if (task) tasks.push(task);
  }
  return tasks.sort((a, b) => Number(a.id) - Number(b.id));
}

/** Remove every task for a project (used by `/task clear`). */
export function resetTaskList(cwd: string): void {
  const dir = tasksDirForCwd(cwd);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
  notifyTasksUpdated(cwd);
}
