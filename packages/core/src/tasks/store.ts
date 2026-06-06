/**
 * Persistent on-disk work task list at ~/.luckycli/tasks/<task-list-id>/<id>.json.
 *
 * A "task" is one item in a structured plan the agent builds for a non-trivial
 * piece of work (an upgrade, a fix, a new feature): subject + description +
 * status (pending → in_progress → completed). One JSON file per task keeps the
 * list inspectable.
 *
 * The list is keyed by a **task list id**, which the CLI binds to the current
 * session id (see setActiveTaskListId). A fresh chat gets a fresh session id,
 * so it starts with an empty list; resuming a session brings its tasks back.
 * This mirrors Claude Code, where the standalone task list is keyed by session
 * id rather than by working directory.
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
  /** Present-continuous form shown in the spinner/panel while in_progress. */
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
 * The task list the tools and the active session read/write. Set once at
 * startup by the CLI (to the session id). Tools resolve it via
 * getActiveTaskListId() rather than depending on the working directory, so the
 * list follows the chat session, not the folder.
 */
let activeTaskListId = "default";

export function setActiveTaskListId(id: string): void {
  activeTaskListId = sanitizePathComponent(id) || "default";
}

export function getActiveTaskListId(): string {
  return activeTaskListId;
}

/**
 * Fired whenever a task list changes. The CLI subscribes to redraw the live
 * task panel. The changed list's id is passed so listeners can ignore lists
 * other than the active one.
 */
const emitter = new EventEmitter();
const TASKS_UPDATED = "tasks-updated";

/** Subscribe to task-list changes. Returns an unsubscribe function. */
export function onTasksUpdated(listener: (taskListId: string) => void): () => void {
  emitter.on(TASKS_UPDATED, listener);
  return () => emitter.off(TASKS_UPDATED, listener);
}

function notifyTasksUpdated(taskListId: string): void {
  emitter.emit(TASKS_UPDATED, taskListId);
}

/**
 * Make a string safe to use as a single path component: only alphanumerics,
 * hyphens and underscores survive. Mirrors Claude Code's sanitizePathComponent.
 */
export function sanitizePathComponent(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, "-");
}

/** Root directory holding every task list. */
export function tasksRootDir(): string {
  return join(homedir(), ".luckycli", "tasks");
}

/** Directory holding the task files for a given task list id. */
export function tasksDirFor(taskListId: string): string {
  return join(tasksRootDir(), sanitizePathComponent(taskListId));
}

function taskFilePath(taskListId: string, id: string): string {
  return join(tasksDirFor(taskListId), `${sanitizePathComponent(id)}.json`);
}

function ensureTasksDir(taskListId: string): string {
  const dir = tasksDirFor(taskListId);
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

/** Highest numeric id currently on disk for this list (0 when empty). */
function highestTaskId(taskListId: string): number {
  const dir = tasksDirFor(taskListId);
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
export function createTask(taskListId: string, data: NewTask): Task {
  ensureTasksDir(taskListId);
  const id = String(highestTaskId(taskListId) + 1);
  const task: Task = TaskSchema.parse({ ...data, id });
  writeJsonAtomic(taskFilePath(taskListId, id), task);
  notifyTasksUpdated(taskListId);
  return task;
}

/** Read a single task, or null if it doesn't exist / fails validation. */
export function getTask(taskListId: string, id: string): Task | null {
  const path = taskFilePath(taskListId, id);
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
  taskListId: string,
  id: string,
  updates: Partial<NewTask>,
): Task | null {
  const existing = getTask(taskListId, id);
  if (!existing) return null;
  const updated: Task = TaskSchema.parse({ ...existing, ...updates, id });
  writeJsonAtomic(taskFilePath(taskListId, id), updated);
  notifyTasksUpdated(taskListId);
  return updated;
}

/** Delete a task by id. Returns true if a file was removed. */
export function deleteTask(taskListId: string, id: string): boolean {
  const path = taskFilePath(taskListId, id);
  if (!existsSync(path)) return false;
  rmSync(path);
  notifyTasksUpdated(taskListId);
  return true;
}

/** All tasks for a list, sorted by numeric id ascending. */
export function listTasks(taskListId: string): Task[] {
  const dir = tasksDirFor(taskListId);
  if (!existsSync(dir)) return [];
  const tasks: Task[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const task = getTask(taskListId, file.slice(0, -".json".length));
    if (task) tasks.push(task);
  }
  return tasks.sort((a, b) => Number(a.id) - Number(b.id));
}

/** Remove every task for a list (used by `/task clear`). */
export function resetTaskList(taskListId: string): void {
  const dir = tasksDirFor(taskListId);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
  notifyTasksUpdated(taskListId);
}

/**
 * Delete task lists whose id is not in `validIds`. Called at startup with the
 * set of still-resumable session ids (plus the active one) so task lists left
 * behind by sessions that no longer exist don't accumulate on disk. Mirrors the
 * spirit of Claude Code clearing the standalone list on a fresh session.
 */
export function cleanupOrphanTaskLists(validIds: Iterable<string>): void {
  const root = tasksRootDir();
  if (!existsSync(root)) return;
  const keep = new Set([...validIds].map((id) => sanitizePathComponent(id)));
  for (const entry of readdirSync(root)) {
    if (keep.has(entry)) continue;
    try {
      rmSync(join(root, entry), { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; ignore failures (e.g. a concurrent process).
    }
  }
}
